import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import type { Services } from '../app-services';
import { setCriteria, taskSections } from '../task-body';
import { serializeTaskMutation } from '../project-task-mutations';

export const AG1_COMPOSE_SHA = '1d126374267b985c58a06678a49a45852acae559f9bf9c8364bc6264cc1bae7a';
const blob = 'f29f5cd7b62b8312f2f796430a134041f0084cb1';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The owner's exact Compose permission extends only the existing acceptance task. */
export async function prepareArchiagentCompose(s: Services, project: string, directory: string) {
  const previous = JSON.parse(
    await readFile(join(directory, 'technical-review-proof.json'), 'utf8'),
  );
  const started = JSON.parse(
    await readFile(join(directory, 'technical-task-started.json'), 'utf8'),
  );
  assert(previous.passed && previous.technical.task === started.task);
  const context = s.projects.get(project),
    taskId = String(started.task),
    run = s.db.latestRun(project, taskId)!;
  assert.equal(taskId, 'T-016');
  assert.equal(run.id, previous.technical.run.id);
  assert(run.worktree);
  assert.equal(await context.git.head(), started.base);
  assert.deepEqual((await context.load()).c4, started.originalModel);
  const bytes = await readFile(join(context.root, 'compose.yaml'));
  assert.equal(bytes.length, 1152);
  assert.equal(sha(bytes), AG1_COMPOSE_SHA);
  const checkpoint = join(directory, 'compose-task-prepared.json');
  let committed: string | undefined;
  try {
    const saved = JSON.parse(await readFile(checkpoint, 'utf8'));
    assert.equal(saved.task, taskId);
    committed = saved.committed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!committed) {
    assert.equal(await context.git.head('HEAD', run.worktree), previous.technical.committed);
    assert.equal((await git(run.worktree, ['status', '--porcelain'])).stdout.trim(), '');
    await serializeTaskMutation(context, async () => {
      const task = await context.store.readTask(taskId);
      assert.equal(
        task.title,
        'Приёмка AG-1: технический результат и постоянный dev-контур Cat-pilot',
      );
      const oldGoal =
        'Только js/pause-controls.js → js/motion-controls.js и единственная ссылка index.html;';
      const oldCriterion =
        'Выполнены только точное переименование JS и одна ссылка index.html, байты и поведение сохранены.';
      assert(task.body.includes(oldGoal) && task.body.includes(oldCriterion));
      const body = setCriteria(
        task.body
          .replace(
            oldGoal,
            `Только js/pause-controls.js → js/motion-controls.js, единственная ссылка index.html и добавление существующего compose.yaml без изменения 1152 байт (SHA256 ${AG1_COMPOSE_SHA}) по отдельному разрешению владельца;`,
          )
          .replace(
            oldCriterion,
            `Выполнены только точное переименование JS, одна ссылка index.html и добавление существующего compose.yaml без изменения 1152 байт (SHA256 ${AG1_COMPOSE_SHA}); байты и поведение сохранены.`,
          ),
        [false, false, false],
      );
      assert.equal(taskSections(body).criteria.length, 3);
      await context.store.updateTask(taskId, { body });
      context.invalidate();
    });
    assert.equal(await s.runs['engine'].results.criteriaChanged(project, taskId), 'open');
    await writeFile(join(run.worktree, 'compose.yaml'), bytes);
    await git(run.worktree, ['add', '--', 'compose.yaml']);
    assert.equal(
      (await git(run.worktree, ['diff', '--cached', '--name-only'])).stdout.trim(),
      'compose.yaml',
    );
    assert.equal((await git(run.worktree, ['rev-parse', ':compose.yaml'])).stdout.trim(), blob);
    await git(run.worktree, [
      'commit',
      '-m',
      ':wrench: chore(dev): track existing Cat-pilot preview compose',
    ]);
    committed = await context.git.head('HEAD', run.worktree);
    await writeFile(
      checkpoint,
      JSON.stringify({ task: taskId, committed, sha256: AG1_COMPOSE_SHA }, null, 2),
    );
  }
  assert.equal(await context.git.head('HEAD', run.worktree), committed);
  assert.equal((await git(run.worktree, ['status', '--porcelain'])).stdout.trim(), '');
  assert.equal(sha(await readFile(join(run.worktree, 'compose.yaml'))), AG1_COMPOSE_SHA);
  assert.equal((await git(run.worktree, ['rev-parse', 'HEAD:compose.yaml'])).stdout.trim(), blob);
  assert.equal(sha(await readFile(join(context.root, 'compose.yaml'))), AG1_COMPOSE_SHA);
  const configPath = join(context.root, '.skaro/config.yaml'),
    before = String(started.configBefore),
    expected = before.replace(
      'node --check js/pause-controls.js',
      'node --check js/motion-controls.js',
    ),
    actual = await readFile(configPath, 'utf8');
  assert(actual === before || actual === expected, 'Preserve concurrent owner configuration');
  if (actual !== expected) await writeFile(configPath, expected);
  context.invalidate();
  return {
    task: taskId,
    run,
    base: String(started.base),
    committed,
    originalModel: started.originalModel,
    previousJob: previous.technical.job.id,
  };
}
