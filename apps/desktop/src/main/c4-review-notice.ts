import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskRunEngine } from './task-run-engine';
import type { C4SemanticJob } from './c4-semantic-store';
import { closeSessionLog } from './close-session-log';

/** Existing diagnostic presentation, with stable identity and flushed history before outbox completion. */
export async function publishC4ReviewNotice(ctx: TaskRunEngine, job: C4SemanticJob) {
  const active = await ctx.history.restore(job.projectId, job.taskId);
  if (!active || active.run.id !== job.runId) throw new Error('C4 review owner changed');
  const aligned =
    job.verdict!.implementation === 'aligned' &&
    ['aligned', 'optional'].includes(job.verdict!.category);
  const id = `skaro-c4-review-${job.id}`;
  if (!active.timeline.state.items.some((i) => i.id === id))
    ctx.history.skaroEvent(active, {
      t: 'item.upsert',
      item: {
        id,
        turnId: active.timeline.state.turns.at(-1)?.id ?? '',
        kind: 'notice',
        code: 'other',
        level: aligned ? 'info' : 'error',
        text: job.verdict!.summary,
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'c4-independent-review', ref: job.id },
      },
    });
  await closeSessionLog(active.log);
  active.log = undefined;
  const handle = await open(join(ctx.deps.dataDir, active.run.logPath), 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (!aligned) ctx.setRuntime(job.projectId, job.taskId, 'failed', job.runId);
}
