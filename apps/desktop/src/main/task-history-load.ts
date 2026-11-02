import { restoreHistory } from './restore-history';
import { join } from 'node:path';
import type { RunRecord } from '@skaro/core';
import { continuationTimeline, Timeline } from '@skaro/timeline';
import type { TaskRunDeps } from './task-run-model';
import { scopeTimeline } from '../shared/task-timeline';

/** Follow explicit predecessors only: unrelated historical runs are not part of this chat. */
export async function loadTaskHistory(deps: Pick<TaskRunDeps, 'dataDir' | 'db'>, run: RunRecord) {
  const chain: RunRecord[] = [];
  const seen = new Set<string>();
  let cursor: RunRecord | undefined = run;
  while (cursor) {
    if (seen.has(cursor.id)) throw new Error('Cyclic task run history');
    if (cursor.projectId !== run.projectId || cursor.taskId !== run.taskId)
      throw new Error('The predecessor belongs to another task');
    seen.add(cursor.id);
    chain.unshift(cursor);
    const previous: string | undefined = cursor.previousRunId;
    cursor = previous ? deps.db.getRun(previous) : undefined;
    if (previous && !cursor) throw new Error('The predecessor run is missing');
  }
  let timeline = new Timeline();
  let seq = 0;
  let segments = 0;
  for (const entry of chain) {
    if (entry.previousRunId) timeline = continuationTimeline(timeline.state);
    const restored = await restoreHistory(
      deps.dataDir,
      join(deps.dataDir, entry.logPath),
      entry.startedAt,
      entry.agent,
      entry.projectId,
      entry.id !== run.id || !!entry.nativeSessionId,
    );
    if (entry.previousRunId) {
      const scoped = Timeline.restore(scopeTimeline(restored.timeline.state, entry.id));
      timeline.state.items.push(...scoped.state.items);
      timeline.state.turns.push(...scoped.state.turns);
      timeline.state.interactions.push(...scoped.state.interactions);
      Object.assign(timeline.state, {
        session: restored.timeline.state.session,
        status: scoped.state.status,
        usage: restored.timeline.state.usage,
        activity: restored.timeline.state.activity,
        limits: restored.timeline.state.limits,
        plan: restored.timeline.state.plan,
      });
      timeline = Timeline.restore(timeline.state);
    } else timeline = restored.timeline;
    seq += restored.seq;
    segments = restored.segments;
  }
  return { timeline, seq, segments };
}
