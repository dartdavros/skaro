import { expect, it } from 'vitest';
import { BackgroundWork, freedResult } from './background-work';
import { reclaimedBytes } from '../../../../packages/core/src/docker/environment';

it('shows running work first and keeps outcomes and failures for the owner to see', async () => {
  const work = new BackgroundWork();
  const states: string[][] = [];
  work.attach((state) => states.push(state.jobs.map((job) => `${job.what}:${job.state}`)));
  await work.run('docker.prune', undefined, async () => 3.2e9, freedResult);
  const index = work.start('graph.index', { project: 'Skaro' });
  work.progress(index, 45.4);
  await expect(
    work.run('merge.retire', { task: 'T-151' }, async () => {
      throw new Error('locked');
    }),
  ).rejects.toThrow('locked');
  const { jobs } = work.snapshot();
  expect(jobs.map((job) => [job.what, job.state])).toEqual([
    ['graph.index', 'running'],
    ['merge.retire', 'failed'],
    ['docker.prune', 'done'],
  ]);
  expect(jobs[0]).toMatchObject({ progress: 45, params: { project: 'Skaro' } });
  expect(jobs[1]).toMatchObject({ error: 'locked' });
  expect(jobs[2]).toMatchObject({ result: { what: 'freed', params: { size: '3.2' } } });
  expect(states[0]).toEqual(['docker.prune:running']);
});

it('reads the space Docker reports as reclaimed', () => {
  expect(reclaimedBytes('Deleted Volumes:\nabc\n\nTotal reclaimed space: 18.39GB\n')).toBe(18.39e9);
  expect(reclaimedBytes('ID\tRECLAIMABLE\nxyz\t1MB\nTotal:\t4.138GB\n')).toBe(4.138e9);
  expect(reclaimedBytes('Total reclaimed space: 0B')).toBe(0);
  expect(freedResult(0)).toEqual({ what: 'nothing' });
});

it('keeps repeated work as one row with its count', () => {
  const work = new BackgroundWork();
  for (let i = 0; i < 3; i++) work.finish(work.start('graph.index', { project: 'Chatballs' }));
  work.finish(work.start('graph.index', { project: 'Skaro' }));
  work.fail(work.start('graph.index', { project: 'Chatballs' }), 'locked');
  const rows = work.snapshot().jobs.map((job) => [job.params?.['project'], job.state, job.runs]);
  expect(rows).toHaveLength(3);
  expect(rows).toContainEqual(['Chatballs', 'done', 3]);
  expect(rows).toContainEqual(['Skaro', 'done', undefined]);
  expect(rows).toContainEqual(['Chatballs', 'failed', undefined]);
});
