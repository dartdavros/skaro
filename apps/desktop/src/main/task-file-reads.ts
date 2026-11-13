import { existsSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { GitSnapshot, type RunRecord } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { integrationCandidate } from './integration-model';
import { recordKey, type RetainedCheckout } from './worktree-retention-model';
import { existingPaths, inside, suggestPaths, suggestListedPaths } from './files';
import { fileDiff } from './file-diff';
import { HistoryFileCache } from './history-file-cache';
import { historicalFileDiff } from './historical-file-diff';
import { pinWorktreeAccess } from './worktree-access';
import { serializeTaskMutation } from './project-task-mutations';
import { ResourceLifecycle } from './resource-lifecycle';

/** Read-only history is independent of admission, session restoration and checkout materialization. */
export class TaskFileReads {
  private readonly ctx: TaskRunEngine;
  private cache?: HistoryFileCache;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }
  async source(projectId: string, taskId: string) {
    const context = this.ctx.project(projectId);
    const integration = integrationCandidate(this.ctx.integrations.store.all(projectId), taskId);
    const run: RunRecord | undefined = this.ctx.deps.db.listRuns(projectId, taskId)[0];
    const cwd = integration?.worktree ?? run?.worktree ?? context.root;
    if (existsSync(cwd)) return { cwd };
    const saved = run?.worktree
      ? this.ctx.deps.db.getSetting<RetainedCheckout | undefined>(
          recordKey(run.worktree),
          undefined,
          { strict: true },
        )
      : undefined;
    const head = integration
      ? integration.head
      : saved?.branch === run?.branch
        ? saved?.head
        : undefined;
    if (!head) throw new Error('Historical checkout has no preserved revision');
    const snapshot = new GitSnapshot(context.root, head);
    await snapshot.verify();
    return { cwd, snapshot, saved: !integration ? saved : undefined };
  }
  private path(cwd: string, path: string): string {
    const abs = inside(cwd, path.replace(/:\d+(?::\d+)?$/, ''));
    if (!abs) throw new Error('File is outside the recorded checkout');
    return relative(cwd, abs).split(sep).join('/');
  }
  async suggest(project: string, task: string, query: string) {
    const { cwd, snapshot } = await this.source(project, task);
    return snapshot ? suggestListedPaths(await snapshot.files(), query) : suggestPaths(cwd, query);
  }
  async exist(project: string, task: string, paths: string[]) {
    const { cwd, snapshot } = await this.source(project, task);
    if (!snapshot) return existingPaths(cwd, paths);
    const files = new Set(await snapshot.files());
    return paths.filter((p) => {
      try {
        return files.has(this.path(cwd, p));
      } catch {
        return false;
      }
    });
  }
  async diff(project: string, task: string, path: string) {
    const { cwd, snapshot, saved } = await this.source(project, task);
    if (!snapshot) return fileDiff(cwd, path);
    const proof = saved?.trackedClean;
    const record = proof && this.ctx.deps.db.resources.get(proof.resourceId);
    const checkpoint =
      record && new ResourceLifecycle(this.ctx.deps.db).read(record, 'worktree.remove');
    const verified =
      !!proof &&
      record?.projectId === project &&
      record.generation === proof.generation &&
      record.identity.path === cwd &&
      record.source?.commit === saved?.head &&
      record.source.recovery === saved?.branch &&
      checkpoint?.id === proof.operationId;
    return historicalFileDiff(
      verified ? saved : undefined,
      (await snapshot.files()).includes(this.path(cwd, path)),
    );
  }
  async open(project: string, task: string, path: string, launch: (path: string) => Promise<void>) {
    // Close the cleanup-vs-open race; the durable pin precedes the OS handoff.
    return serializeTaskMutation(this.ctx.project(project), async () => {
      const { cwd, snapshot } = await this.source(project, task);
      const relative = this.path(cwd, path);
      if (!snapshot) {
        if (cwd !== this.ctx.project(project).root)
          pinWorktreeAccess(this.ctx.deps.db, project, cwd);
        return launch(inside(cwd, relative)!);
      }
      this.cache ??= new HistoryFileCache(this.ctx.deps.db, this.ctx.deps.dataDir);
      return this.cache.open(project, snapshot, relative, launch);
    });
  }
  async sweep() {
    this.cache ??= new HistoryFileCache(this.ctx.deps.db, this.ctx.deps.dataDir);
    await this.cache.sweep();
  }
}
