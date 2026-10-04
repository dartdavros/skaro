import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import { expect, it } from 'vitest';
import {
  repo,
  worktree,
  db,
  projects,
  tasks,
  projectId,
  taskId,
  scope,
  resetTaskRuns,
} from './task-run-test-support';

async function merge(strategy: 'squash' | 'merge' | 'rebase' = 'squash'): Promise<string> {
  const context = projects.get(projectId);
  const { config } = await context.load();
  await context.store.writeConfig({ ...config, merge: { ...config.merge, strategy } });
  context.invalidate();
  await tasks.mergeTask({}, scope());
  const card = (await tasks.open(projectId, taskId)).timeline!.interactions.find(
    (i) => i.kind === 'merge',
  )!;
  await tasks.merge(projectId, taskId, card.id, { action: 'confirm', message: 'merge task' });
  return db.listMerges(projectId, taskId)[0]!.commit;
}

it.each(['squash', 'merge', 'rebase'] as const)(
  'reverts a %s merge and review metadata together while retaining task data',
  async (strategy) => {
    const commit = await merge(strategy);
    await tasks.revertMerge(projectId, taskId, commit);
    const reverted = db.listMerges(projectId, taskId)[0]!;
    expect(reverted.revertCommit).toBeTruthy();
    expect(await projects.get(projectId).git.head()).toBe(reverted.revertCommit);
    expect((await projects.get(projectId).store.readTask(taskId)).status).toBe('review');
    expect(existsSync(join(repo, 'feature.txt'))).toBe(false);
    expect(await readFile(join(worktree, 'feature.txt'), 'utf8')).toBe('feature');
    expect(await readFile(join(worktree, 'data', 'postgres', 'PG_VERSION'), 'utf8')).toBe('16');
    expect((await tasks.open(projectId, taskId)).timeline!.items).toContainEqual(
      expect.objectContaining({
        kind: 'notice',
        text: 'Слияние отменено',
        native: expect.objectContaining({ type: 'merge_reverted' }),
      }),
    );
    expect(
      (
        await git(repo, [
          'show',
          'HEAD:' + (await projects.get(projectId).store.readTask(taskId)).path,
        ])
      ).stdout,
    ).toContain('status: review');
    const head = await projects.get(projectId).git.head();
    await tasks.revertMerge(projectId, taskId, commit);
    expect(await projects.get(projectId).git.head()).toBe(head);
  },
  15_000,
);

it('restores the recorded base needed to revert a rebase merge after restart', async () => {
  const commit = await merge('rebase');
  await tasks.close();
  resetTaskRuns();
  await tasks.open(projectId, taskId);
  await tasks.revertMerge(projectId, taskId, commit);
  expect(existsSync(join(repo, 'feature.txt'))).toBe(false);
  expect((await projects.get(projectId).store.readTask(taskId)).status).toBe('review');
}, 15_000);

it('preserves the main branch and merge record when later work conflicts with reversal', async () => {
  const commit = await merge();
  await writeFile(join(repo, 'feature.txt'), 'later owner work');
  await git(repo, ['add', 'feature.txt']);
  await git(repo, ['commit', '-qm', 'later owner work']);
  const head = await projects.get(projectId).git.head();
  await expect(tasks.revertMerge(projectId, taskId, commit)).rejects.toThrow('Revert conflicts');
  expect(await projects.get(projectId).git.head()).toBe(head);
  expect(await readFile(join(repo, 'feature.txt'), 'utf8')).toBe('later owner work');
  expect(db.listMerges(projectId, taskId)[0]?.revertCommit).toBeUndefined();
  expect((await projects.get(projectId).store.readTask(taskId)).status).toBe('done');
}, 15_000);

it('rejects an unrelated commit and a dirty base without touching owner edits', async () => {
  const commit = await merge();
  await expect(tasks.revertMerge(projectId, taskId, 'unrelated')).rejects.toThrow(
    'not a recorded merge',
  );
  await writeFile(join(repo, 'feature.txt'), 'uncommitted owner work');
  await expect(tasks.revertMerge(projectId, taskId, commit)).rejects.toThrow('uncommitted');
  expect(await readFile(join(repo, 'feature.txt'), 'utf8')).toBe('uncommitted owner work');
  expect(db.listMerges(projectId, taskId)[0]?.revertCommit).toBeUndefined();
}, 15_000);
