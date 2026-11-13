import type { DecisionSource } from '../shared/project-decisions';
import type { TaskRunEngine } from './task-run-engine';
import { loadTaskHistory } from './task-history-load';
import { taskDecisionTimeline, integrationDecisionLive } from './decision-projection';
import { key } from './task-run-helpers';
import { emptyTimeline } from '@skaro/timeline';

/** Reads canonical histories without restoring a runtime, queuing delivery or materializing a checkout. */
export async function taskDecisionSources(
  ctx: TaskRunEngine,
  projectId: string,
  only?: string,
): Promise<DecisionSource[]> {
  const context = ctx.project(projectId),
    artifacts = await context.summary();
  const subjects = [...artifacts.tasks, ...artifacts.milestones];
  const result: DecisionSource[] = [];
  for (const task of subjects) {
    if (only && task.id !== only) continue;
    const completed = 'status' in task && task.status === 'done';
    const run = ctx.deps.db.listRuns(projectId, task.id)[0];
    const active = ctx.active.get(key(projectId, task.id));
    const current = active?.run.id === run?.id ? active : undefined;
    const base =
      current?.timeline.state ??
      (run ? (await loadTaskHistory(ctx.deps, run)).timeline.state : emptyTimeline());
    const baseLive = !!current?.session && base.turns.some((turn) => !turn.outcome);
    const hidden = ctx.deps.db.getSetting<string[]>(
      `task.${projectId}.${task.id}.clearedIntegrations`,
      [],
    );
    const integration = await ctx.integrations.history.project(
      projectId,
      task.id,
      taskDecisionTimeline(base, baseLive, completed),
      hidden,
    );
    // Each integration owns its native permission lifetime independently of the task's base session.
    const state = taskDecisionTimeline(base, baseLive, completed);
    const requestEpochs: Record<string, string> = {};
    for (const source of integration.sources.integrations) {
      const worker = ctx.integrations.liveWorker(projectId, source.id);
      const snapshot = taskDecisionTimeline(
        source.timeline,
        integrationDecisionLive(source.timeline, source.id, worker),
        completed,
        `integration-${source.id}:${worker}:`,
      );
      state.interactions.push(...snapshot.interactions);
      for (const interaction of snapshot.interactions)
        requestEpochs[interaction.id] = snapshot.turns.at(-1)?.id ?? '';
      state.items.push(...snapshot.items);
    }
    result.push({
      projectId,
      kind: 'task',
      id: task.id,
      title: task.title,
      epoch: run?.id ?? '',
      cwd: current?.run.worktree ?? run?.worktree ?? context.root,
      timeline: state,
      requestEpochs,
    });
  }
  return result;
}
