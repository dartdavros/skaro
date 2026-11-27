import { incidentHash, type CoordinationBlocker, type IncidentSubscription } from '@skaro/core';
import {
  validateQuestionAnswer,
  type Interaction,
  type InteractionAnswer,
  type TimelineEvent,
} from '@skaro/timeline';
import type { TaskRunEngine } from './task-run-engine';
import { currentIncidentSubscriber } from './incident-condition';
import { QuestionAnswers } from './question-answers';
import { cancelIncidentApproval, closeIncidentApproval } from './incident-feed';
import { incidentModelPlan } from './incident-model-plan';
import { diagnoseIncident } from './incident-model-diagnosis';
import { decisionHash } from './decision-projection';
import { retireLegacyIncidentQuestion } from './incident-legacy-question';
import { DecisionNotDispatched } from './decision-not-dispatched';
import type { ActiveRun } from './task-run-model';
import { environmentFailureHandoff } from './environment-incident-handoff';

/** Unsupported recovery needs a durable, pinned decision, not an invisible waiting record. */
export async function escalateIncident(ctx: TaskRunEngine, row: CoordinationBlocker) {
  const recovery = environmentFailureHandoff(ctx.deps.db, row);
  if (recovery) {
    await retireLegacyIncidentQuestion(ctx, row);
    await diagnoseIncident(ctx, row, recovery);
    return;
  }
  const plan = incidentModelPlan(ctx.deps.db, row);
  if (!plan) {
    await retireLegacyIncidentQuestion(ctx, row);
    await diagnoseIncident(ctx, row);
    return;
  }
  if (!plan.options.length) return;
  const id = incidentHash([row.id, 'owner-evidence', row.protocol!.ownerPolicyRevision, plan]);
  const existing = ctx.deps.db.coordination.decisions.get(row.projectId, id);
  if (existing && existing.state !== 'pending') return;
  if (row.protocol!.decisionId && row.protocol!.decisionId !== id)
    await cancelIncidentApproval(ctx, row, row.protocol!.decisionId, 'decision_superseded');
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
          text: `${plan.explanation}\n\n${plan.question}`,
          multi: false,
          allowFreeText: true,
          options: plan.options,
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
  const activeSubscribers: {
    active: ActiveRun;
    mailbox: QuestionAnswers;
    interaction: Extract<Interaction, { kind: 'question' }>;
    subscription: IncidentSubscription;
    events: TimelineEvent[];
  }[] = [];
  for (const subscription of row.protocol!.subscriptions) {
    const active = await ctx.history.restore(row.projectId, subscription.taskId);
    const interaction = active?.timeline.state.interactions.find(
      (i) => i.id === `coordinator:${id}`,
    );
    if (!active || interaction?.kind !== 'question') continue;
    if (!(await currentIncidentSubscriber(ctx, row.projectId, subscription))) continue;
    const mailbox = new QuestionAnswers(ctx.deps.db, `active.${active.run.id}`);
    try {
      validateQuestionAnswer(interaction, answer);
    } catch (error) {
      throw new DecisionNotDispatched(error);
    }
    activeSubscribers.push({
      active,
      mailbox,
      interaction,
      subscription,
      events: [] as TimelineEvent[],
    });
  }
  if (!activeSubscribers.length) throw new DecisionNotDispatched('decision_stale');
  ctx.deps.db.settings.atomic(() => {
    const currentDecision = ctx.deps.db.coordination.decisions.get(row.projectId, id);
    const currentRow = ctx.incidents.store.get(row.projectId, row.id);
    if (
      currentDecision?.revision !== decision.revision ||
      currentDecision.state !== 'pending' ||
      currentRow.state !== 'open' ||
      currentRow.protocol!.decisionId !== id
    )
      throw new DecisionNotDispatched('decision_stale');
    for (const { active, mailbox, interaction, subscription, events } of activeSubscribers)
      mailbox.accept(
        interaction,
        answer,
        (event) => events.push(event),
        active.timeline.state.turns.at(-1)?.id,
        { runId: subscription.runId, intent: subscription.intent },
      );
    ctx.deps.db.coordination.decisions.transition(row.projectId, id, {
      expectedRevision: decision.revision,
      state: 'answered',
      evidence: {
        code: 'owner_answer_recorded',
        refs: [row.subject],
        fingerprint: decisionHash({ kind: 'respond', answer }),
      },
    });
    for (const { active, mailbox } of activeSubscribers)
      mailbox.queue(
        'task.send',
        row.projectId,
        active.taskId,
        mailbox.project(active.timeline.state),
      );
  });
  for (const { active, events } of activeSubscribers)
    for (const event of events) ctx.history.skaroEvent(active, event);
  await closeIncidentApproval(ctx, row, id, answer);
}
