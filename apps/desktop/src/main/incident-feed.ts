import type { CoordinationBlocker, RemedyAction } from '@skaro/core';
import type { Interaction, InteractionAnswer } from '@skaro/timeline';
import type { TaskRunEngine } from './task-run-engine';

/** Reuses the existing pinned approval interaction; AC-4 owns the future global presentation. */
export async function showIncidentApproval(
  ctx: TaskRunEngine,
  row: CoordinationBlocker,
  action: RemedyAction,
  decisionId: string,
) {
  const subscription = row.protocol!.subscriptions[0];
  if (!subscription) return;
  const active = await ctx.history.restore(row.projectId, subscription.taskId);
  if (!active || active.run.id !== subscription.runId) return;
  const interaction: Interaction = {
    kind: 'approval',
    delivery: 'async',
    id: `coordinator:${decisionId}`,
    action: {
      type: 'other',
      title: action.kind === 'environment.start' ? 'start_environment' : 'check_prerequisites',
      reason: `${row.protocol!.code}; ${row.protocol!.subscriptions.map((s) => s.taskId).join(', ')}`,
    },
    choices: ['allow_once', 'deny'],
  };
  if (active.timeline.state.interactions.some((i) => i.id === interaction.id)) return;
  ctx.history.skaroEvent(active, { t: 'interaction.opened', interaction });
}
/** Mechanical cancellation is not consent. */
export async function cancelIncidentApproval(
  ctx: TaskRunEngine,
  row: CoordinationBlocker,
  id: string,
  code: string,
) {
  const decision = ctx.deps.db.coordination.decisions.get(row.projectId, id);
  if (decision?.state === 'pending')
    ctx.deps.db.coordination.decisions.transition(row.projectId, id, {
      expectedRevision: decision.revision,
      state: 'cancelled',
      evidence: { code, refs: [row.subject] },
    });
  for (const s of row.protocol!.subscriptions) {
    const active = await ctx.history.restore(row.projectId, s.taskId);
    if (
      active?.run.id === s.runId &&
      active.timeline.state.interactions.some((i) => i.id === `coordinator:${id}`)
    )
      ctx.history.skaroEvent(active, {
        t: 'interaction.closed',
        id: `coordinator:${id}`,
        resolution: 'cancelled',
      });
  }
}

export async function closeIncidentApproval(
  ctx: TaskRunEngine,
  row: CoordinationBlocker,
  decisionId: string,
  answer: InteractionAnswer,
) {
  for (const s of row.protocol!.subscriptions) {
    const active = await ctx.history.restore(row.projectId, s.taskId);
    if (!active || active.run.id !== s.runId) continue;
    const interaction = active.timeline.state.interactions.find(
      (i) => i.id === `coordinator:${decisionId}`,
    );
    if (!interaction) continue;
    ctx.history.skaroEvent(active, {
      t: 'interaction.closed',
      id: interaction.id,
      resolution: answer.kind === 'approval' && answer.choice === 'deny' ? 'cancelled' : 'answered',
    });
    ctx.history.skaroEvent(active, {
      t: 'item.upsert',
      item: {
        id: `skaro-decision-${interaction.id}`,
        turnId: '',
        kind: 'decision',
        interaction,
        answer,
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'decision', ref: interaction.id },
      },
    });
  }
}
