import assert from 'node:assert/strict';
import { readFile, writeFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { c4Hash, type AppDb } from '@skaro/core';
import { ArtifactFiles } from '../../../../../packages/core/src/artifacts/files';
import { TaskRunProcesses } from '../task-run-processes';
import { TaskExecution } from '../task-execution';
import { CompletionStore } from '../completion-store';
import { C4SemanticStore } from '../c4-semantic-store';
import { latestC4LiveProof } from './c4-live-proof';
import { monitorC4PublicationBeforeServices } from './c4-publication-checkpoint';

/** Preserve the existing check; update its one dependent filename, never disable or replace it. */
export async function prepareC4PublicationRetry(
  db: AppDb,
  data: string,
  project: string,
  directory: string,
) {
  assert.equal(db.shell.projectScope, project);
  const root = db.getProject(project)!.path;
  const evidence = (await latestC4LiveProof(data, project, 'fault-task')).proof.faultTask;
  const task = String(evidence.taskId),
    run = db.latestRun(project, task)!;
  assert.equal(run.id, evidence.run.id);
  const result = new CompletionStore(db, project).result(task)!;
  assert(result && result.head === '75138acc5cd1a769fc2ade158144454c1fa1ec26');
  const review = new C4SemanticStore(db).current(run.id)!;
  assert.equal(
    c4Hash(await readFile(join(root, 'js/controls.js'), 'utf8')),
    review.observation.files.find((f) => f.path === 'js/pause-controls.js')!.hash,
  );
  await new TaskRunProcesses(db).stop(run.id);
  new TaskExecution(db, run.id).stop();
  const config = join(root, '.skaro/config.yaml');
  const before = await readFile(config, 'utf8');
  const oldCommand = 'run: node --check js/controls.js',
    newCommand = 'run: node --check js/pause-controls.js';
  const after = before.includes(oldCommand) ? before.replace(oldCommand, newCommand) : before;
  assert.equal(after.split(newCommand).length, 2);
  assert(!after.includes(oldCommand));
  assert(
    !(await readFile(join(run.worktree!, '.skaro/config.yaml'), 'utf8')).includes(oldCommand),
    'Do not silently change an already accepted result tree',
  );
  await writeFile(join(directory, 'config-before.yaml'), before);
  await writeFile(join(directory, 'config-after.yaml'), after);
  assert.equal(await readFile(config, 'utf8'), before, 'Preserve concurrent owner config edits');
  if (before !== after) await new ArtifactFiles(root).writeCreatedFile('config.yaml', after);
  const handle = await open(config, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  assert.equal(await readFile(config, 'utf8'), after);
  await writeFile(
    join(directory, 'check-reference-fix.json'),
    JSON.stringify(
      {
        task,
        result: result.head,
        oldCommand,
        newCommand,
        beforeHash: c4Hash(before),
        afterHash: c4Hash(after),
        onlyChange:
          'Exact filename reference in the same existing check; all other config bytes preserved',
        acceptedResultUnchanged: true,
      },
      null,
      2,
    ),
  );
  const stop = await monitorC4PublicationBeforeServices(db, project, directory, task);
  return { task, stop };
}
