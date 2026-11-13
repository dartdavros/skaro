import { incidentHash, type CoordinationBlocker } from '@skaro/core';
import type { Interaction, InteractionAnswer } from '@skaro/timeline';
import type { TaskRunEngine } from './task-run-engine';
import { currentIncidentSubscriber } from './incident-condition';
import { QuestionAnswers } from './question-answers';
import { closeIncidentApproval } from './incident-feed';

/** Unsupported recovery needs a durable, pinned decision, not an invisible waiting record. */
export async function escalateIncident(ctx: TaskRunEngine, row: CoordinationBlocker) {
  const id = incidentHash([row.id, 'owner-evidence', row.protocol!.ownerPolicyRevision]);
  const existing = ctx.deps.db.coordination.decisions.get(row.projectId, id);
  if (existing && existing.state !== 'pending') return;
  if (!existing)
    ctx.deps.db.coordination.decisions.create({
      id,
      projectId: row.projectId,
      eventId: row.eventId,
      kind: 'question',
      subject: { kind: 'blocker', id: row.id },
      inputHash: row.inputHash,
    });
  row = ctx.incidents.store.update(ctx.incidents.store.get(row.projectId, row.id), {
    decisionId: id,
  });
  const resource = ctx.deps.db.resources.get(row.subject.id);
  const reason = resource?.lastOutcome?.reason ?? row.protocol!.code;
  for (const subscription of row.protocol!.subscriptions) {
    if (!(await currentIncidentSubscriber(ctx, row.projectId, subscription))) continue;
    const active = await ctx.history.restore(row.projectId, subscription.taskId);
    if (!active || active.run.id !== subscription.runId) continue;
    const interaction: Interaction = {
      kind: 'question',
      id: `coordinator:${id}`,
      delivery: 'async',
      questions: [
        {
          id: 'resolution',
          header: subscription.taskId,
          text: `Skaro: ${row.protocol!.code}; ${reason}. Автоматическое восстановление недоступно. Укажите решение для этой блокировки.`,
          multi: false,
          allowFreeText: true,
          options: [],
        },
      ],
    };
    if (!active.timeline.state.interactions.some((i) => i.id === interaction.id))
      ctx.history.skaroEvent(active, { t: 'interaction.opened', interaction });
  }
}

/** Deliver the answer as owner input. It is not evidence of a repaired environment or consent to resume Stop. */
export async function answerIncidentEscalation(
  ctx: TaskRunEngine,
  row: CoordinationBlocker,
  id: string,
  answer: InteractionAnswer,
) {
  if (answer.kind !== 'question') throw new Error('Incident requires an owner answer');
  const decision = ctx.deps.db.coordination.decisions.get(row.projectId, id)!;
  const activeSubscribers = [];
  for (const subscription of row.protocol!.subscriptions) {
    const active = await ctx.history.restore(row.projectId, subscription.taskId);
    const interaction = active?.timeline.state.interactions.find(
      (i) => i.id === `coordinator:${id}`,
    );
    if (!active || interaction?.kind !== 'question') continue;
    if (!(await currentIncidentSubscriber(ctx, row.projectId, subscription))) continue;
    const mailbox = new QuestionAnswers(ctx.deps.db, `active.${active.run.id}`);
    mailbox.accept(
      interaction,
      answer,
      (event) => ctx.history.skaroEvent(active, event),
      active.timeline.state.turns.at(-1)?.id,
      { runId: subscription.runId, intent: subscription.intent },
    );
    activeSubscribers.push({ active, mailbox });
  }
  ctx.deps.db.coordination.decisions.transition(row.projectId, id, {
    expectedRevision: decision.revision,
    state: 'answered',
    evidence: {
      code: 'owner_answer_recorded',
      refs: [row.subject],
      fingerprint: incidentHash(answer),
    },
  });
  await closeIncidentApproval(ctx, row, id, answer);
  for (const { active, mailbox } of activeSubscribers)
    mailbox.queue('task.send', row.projectId, active.taskId, active.timeline.state);
}
