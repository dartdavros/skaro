import { expect, it } from 'vitest';
import { TaskMutationQueue } from './task-mutation-queue';

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('admits a different task while cleanup excludes its own checkout, shared owners and graph edits', async () => {
  const queue = new TaskMutationQueue();
  const started = signal();
  const release = signal();
  const cleanup = queue.clean(
    () => new Set(['T-009', 'M01']),
    async () => {
      started.resolve();
      await release.promise;
      throw new Error('cleanup failed');
    },
  );
  await started.promise;
  const entered: string[] = [];
  const run = (label: string, owner?: string) =>
    queue.run(async () => {
      entered.push(label);
    }, owner);
  const same = run('restore', 'T-009');
  const shared = run('shared', 'M01');
  const graph = run('graph');
  await run('launch', 'T-010');
  expect(entered).toEqual(['launch']);
  release.resolve();
  await expect(cleanup).rejects.toThrow('cleanup failed');
  await Promise.all([same, shared, graph]);
  expect(entered).toEqual(['launch', 'restore', 'shared', 'graph']);
});
