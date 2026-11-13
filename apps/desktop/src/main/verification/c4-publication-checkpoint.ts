import { app } from 'electron';
import {
  watch,
  readFileSync,
  readdirSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { ArtifactStore, c4Hash, git, type AppDb, type ProjectArtifacts } from '@skaro/core';
import type { Services } from '../app-services';
import { CompletionStore } from '../completion-store';
import { C4SemanticStore } from '../c4-semantic-store';

/** Observe the REAL ref update and journal; no substitute state enters the workflow. */
export async function monitorC4Publication(
  s: Services,
  project: string,
  directory: string,
  taskId = 'T-012',
) {
  const context = s.projects.get(project),
    artifacts = await context.store.load();
  return armC4Publication(s.db, context.root, artifacts, project, directory, taskId);
}

/** Arm before normal startup can retry an already accepted publication. */
export async function monitorC4PublicationBeforeServices(
  db: AppDb,
  project: string,
  directory: string,
  taskId: string,
) {
  const registered = db.getProject(project);
  if (!registered || db.shell.projectScope !== project)
    throw new Error('Invalid verification scope');
  return armC4Publication(
    db,
    registered.path,
    await new ArtifactStore(registered.path).load(),
    project,
    directory,
    taskId,
  );
}

async function armC4Publication(
  db: AppDb,
  root: string,
  artifacts: ProjectArtifacts,
  project: string,
  directory: string,
  taskId: string,
) {
  const config = artifacts.config;
  const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
  const ref = (
    await git(root, [
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      `refs/heads/${config.baseBranch}`,
    ])
  ).stdout.trim();
  const before = (await git(root, ['rev-parse', config.baseBranch])).stdout.trim();
  const store = new CompletionStore(db, project);
  let triggered = false;
  const observe = () => {
    if (triggered) return;
    let current: string;
    try {
      current = readFileSync(ref, 'utf8').trim();
    } catch {
      return;
    }
    if (current === before) return;
    const operation = store
      .operations()
      .findLast(
        (op) =>
          op.state === 'prepared' &&
          op.commit === current &&
          op.before === before &&
          op.results.length === 1 &&
          op.results[0]?.taskId === taskId,
      );
    if (!operation) return;
    const journal = readdirSync(gitDir)
      .filter((name) => name.startsWith('skaro-merge-recovery-'))
      .map((name) => join(gitDir, name, 'journal.json'))
      .find((path) => {
        try {
          const value = JSON.parse(readFileSync(path, 'utf8'));
          return (
            value.ownerPid === process.pid && value.commit === current && value.before === before
          );
        } catch {
          return false;
        }
      });
    if (!journal) return;
    triggered = true;
    const run = db.latestRun(project, taskId)!;
    const review = new C4SemanticStore(db).current(run.id)!;
    const checkpoint = {
      projectId: project,
      taskId,
      originalModel: artifacts.c4,
      directory,
      pid: process.pid,
      before,
      commit: current,
      operation,
      journal,
      journalHash: c4Hash(readFileSync(journal, 'utf8')),
      run,
      reviewNativeSessionId: review.reviewer!.nativeSessionId,
      reviewLogCount: readdirSync(dirname(review.reviewer!.log)).filter((f) => f.endsWith('.jsonl'))
        .length,
      pending: db.coordination
        .pending(project)
        .filter((op) => op.action === 'mcp.submit_result' && op.subject.id === taskId),
      boundary:
        'actual base ref updated; real publication journal and prepared operation still present',
      at: new Date().toISOString(),
    };
    const file = join(directory, 'crash-checkpoint.json');
    writeFileSync(file, JSON.stringify(checkpoint, null, 2));
    const fd = openSync(file, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    process.send?.({ stage: 'actual-c4-publication-interrupted', checkpoint: file, exitCode: 73 });
    app.exit(73);
  };
  const watcher = watch(dirname(ref), observe),
    timer = setInterval(observe, 25);
  return () => {
    watcher.close();
    clearInterval(timer);
  };
}
