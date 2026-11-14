import { expect, it } from 'vitest';
import { EnvironmentWork } from './environment-work';

it('runs independent owners while ordering one owner and draining maintenance before later work', async () => {
  const work = new EnvironmentWork();
  const a = { projectId: 'one', taskId: 'shared-id' };
  const b = { projectId: 'two', taskId: 'shared-id' };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const events: string[] = [];
  const first = work.run(
    a,
    async () => {
      events.push('start');
      await gate;
    },
    true,
  );
  await work.run(b, async () => {
    events.push('independent-config');
  });
  expect(work.starting()).toEqual([a]);
  const same = work.run(a, async () => {
    events.push('same-owner-config');
  });
  const maintenance = work.exclusive(async () => {
    events.push('maintenance');
  });
  const later = work.run(b, async () => {
    events.push('after-maintenance');
  });
  expect(events).toEqual(['start', 'independent-config']);
  release();
  await Promise.all([first, same, maintenance, later, work.idle()]);
  expect(events).toEqual([
    'start',
    'independent-config',
    'same-owner-config',
    'maintenance',
    'after-maintenance',
  ]);
  expect(work.starting()).toEqual([]);
});

it('releases failed starts and maintenance without poisoning future work or shutdown', async () => {
  const work = new EnvironmentWork();
  const key = { projectId: 'repository', taskId: 'owner' };
  await expect(
    work.run(
      key,
      async () => {
        throw new Error('cancelled');
      },
      true,
    ),
  ).rejects.toThrow('cancelled');
  expect(work.starting()).toEqual([]);
  await expect(
    work.exclusive(async () => {
      throw new Error('cleanup failed');
    }),
  ).rejects.toThrow('cleanup failed');
  await expect(work.run(key, async () => 'ready')).resolves.toBe('ready');
  await work.idle();
});
