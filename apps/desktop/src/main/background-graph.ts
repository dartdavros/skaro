import type { GraphStatus } from '@skaro/core/graph-view';
import { backgroundWork } from './background-work';
import type { BackgroundJob } from '../shared/background';

const indexing = new Map<string, BackgroundJob>();

/** Code indexing runs by itself on every change: the title bar shows each run and its outcome. */
export function reportGraph(status: GraphStatus, project: string): void {
  let job = indexing.get(status.projectId);
  if (status.phase === 'indexing') {
    if (!job) {
      job = backgroundWork.start('graph.index', { project });
      indexing.set(status.projectId, job);
    }
    if (status.progress?.total)
      backgroundWork.progress(job, (status.progress.done / status.progress.total) * 100);
    return;
  }
  if (!job || status.phase === 'queued') return;
  indexing.delete(status.projectId);
  if (status.phase === 'error') backgroundWork.fail(job, status.error ?? 'error');
  else if (status.phase === 'cancelled') backgroundWork.finish(job, { what: 'cancelled' });
  else backgroundWork.finish(job);
}
