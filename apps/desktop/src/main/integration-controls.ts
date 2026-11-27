import {
  operationTimeout,
  isAsyncQuestion,
  validateQuestionAnswer,
  assertQuestionMessageAllowed,
  questionMessageNote,
  withSkaroNote,
  type InteractionAnswer,
} from '@skaro/timeline';
import type { MessageInput } from '../shared/ipc';
import { isTaskParked } from '@skaro/core';
import { bindTaskDestination } from './owner-command-provenance';
import { resourcesFor } from './resource-execution';
import type { TaskRunEngine } from './task-run-engine';
import type { ResolverSession } from './integration-worker';
import { QuestionAnswers } from './question-answers';
import { recordQuestionAcceptance } from './question-answer-proof';
import { decisionItemId } from './decision-item-id';
import { DecisionNotDispatched } from './decision-not-dispatched';
import { taskQuestionContext } from './question-cancel-handlers';
import { hasOwnerCommand } from './owner-command-history';
import { renewIntegrationDispatch, requireIntegrationDispatch } from './integration-dispatch-fence';
import { decisionIsSafety } from './decision-authority';
import { isTaskContinuationInput } from './integration-routing';
import { ownerResumeText } from './task-follow-up';
import type { TimelineEvent } from '@skaro/timeline';
import { cancelQuestionRequests, supersedeQuestionInput } from './question-cancellation';
import {
  integrationQuestionContext,
  integrationQuestionReferences,
} from './integration-question-context';
import {
  currentIntegration,
  integrationQueueKey,
  participatesIn,
  type IntegrationOperation,
} from './integration-model';

const CONTROLLED: IntegrationOperation['state'][] = [
  'preparing',
  'resolving',
  'verifying',
  'paused',
  'waiting',
  'failed',
];

/** User input addresses the current candidate writer; a stopped writer never resumes implicitly. */
export class IntegrationControls {
  private readonly ctx: TaskRunEngine;
  private readonly sessions: Map<string, ResolverSession>;
  constructor(ctx: TaskRunEngine, sessions: Map<string, ResolverSession>) {
    this.ctx = ctx;
    this.sessions = sessions;
  }

  /** The chat of every task of a merge controls it, not only the chat of its first task. */
  private current(projectId: string, taskId: string): IntegrationOperation | undefined {
    return currentIntegration(this.ctx.integrations.store.all(projectId), taskId, CONTROLLED);
  }

  async send(projectId: string, taskId: string, input: MessageInput): Promise<boolean> {
    if (input.resumeTask || isTaskContinuationInput(input)) return false;
    const op = this.current(projectId, taskId);
    if (!op) return false;
    // Owner text in a parked task belongs to that task, even with a candidate in its feed.
    if (!input.internal && (op.purpose === 'local' || ownerResumeText(input))) {
      const db = this.ctx.deps.db;
      const { tasks } = await this.ctx.project(projectId).summary();
      const task = tasks.find((item) => item.id === taskId);
      if (task && isTaskParked(task.status)) {
        if (input.commandId) bindTaskDestination(db, projectId, taskId, input.commandId);
        return false;
      }
    }
    if (
      !input.internal &&
      input.supersededQuestions?.some((ref) => !ref.id.startsWith(`integration-${op.id}:`))
    ) {
      const base = await this.ctx.history.restore(projectId, taskId);
      if (base) input = await supersedeQuestionInput(taskQuestionContext(this.ctx, base), input);
    }
    await this.deliver(op, input, !input.internal);
    return true;
  }

  async cancelQuestion(
    project: string,
    task: string,
    id: string,
    reason: string,
  ): Promise<boolean> {
    const op = this.ctx.integrations.store
      .all(project)
      .find((value) => participatesIn(value, task) && id.startsWith(`integration-${value.id}:`));
    if (!op) return false;
    const context = await integrationQuestionContext(this.ctx, op, this.sessions.get(op.id));
    const question = context.state.interactions.find(
      (q) => q.id === id.slice(`integration-${op.id}:`.length),
    );
    if (question?.kind !== 'question') throw new Error('Question is no longer open');
    await cancelQuestionRequests(context, [question], reason);
    return true;
  }

  async recover(op: IntegrationOperation): Promise<void> {
    const mailbox = new QuestionAnswers(this.ctx.deps.db, `integration.${op.id}`);
    const events: TimelineEvent[] = [];
    mailbox.recover((await this.ctx.integrations.history.state(op)).state, (event) =>
      events.push(event),
    );
    for (const event of events) await this.ctx.integrations.history.event(op, event);
    const input = mailbox.pending((await this.ctx.integrations.history.state(op)).state);
    if (input && ['preparing', 'resolving', 'verifying', 'waiting'].includes(op.state)) {
      await this.deliver(op, input);
      mailbox.delivered();
    }
  }

  private async deliver(
    op: IntegrationOperation,
    input: MessageInput,
    freshOwner = false,
  ): Promise<void> {
    const context = await integrationQuestionContext(this.ctx, op, this.sessions.get(op.id));
    input = await supersedeQuestionInput(context, {
      ...input,
      supersededQuestions: integrationQuestionReferences(input.supersededQuestions, op.id),
    });
    const timeline = context.state;
    assertQuestionMessageAllowed(timeline, input.internal);
    if (hasOwnerCommand(timeline, input.commandId)) return;
    if (freshOwner) renewIntegrationDispatch(this.ctx.deps.db, op.projectId, op.id);
    else requireIntegrationDispatch(this.ctx.deps.db, op.projectId, op.id);
    const live = this.sessions.get(op.id);
    if (live) {
      const decoded = this.ctx.integrations.history.secrets(op).input(input);
      await live.session.steer({
        ...decoded,
        text: withSkaroNote(
          [
            input.commandId ? `command_id: ${input.commandId}` : '',
            questionMessageNote(timeline, input.internal),
          ]
            .filter(Boolean)
            .join('\n'),
          decoded.text,
        ),
      });
    } else {
      this.ctx.integrations.store.appendInput(op.id, input);
      if (op.executor) return;
      op.state = 'resolving';
      op.attempts = 0;
      if (freshOwner) op.coordinatorRecovery = undefined;
      this.ctx.integrations.service.save(op);
      this.ctx.integrations.enqueue(op);
    }
  }

  async respond(
    projectId: string,
    taskId: string,
    id: string,
    answer: InteractionAnswer,
  ): Promise<boolean> {
    const op = this.ctx.integrations.store
      .all(projectId)
      .find((value) => participatesIn(value, taskId) && id.startsWith(`integration-${value.id}:`));
    if (!op) return false;
    const scoped = id.slice(`integration-${op.id}:`.length);
    const timeline = await this.ctx.integrations.history.state(op);
    const interaction = timeline.state.interactions.find((value) => value.id === scoped);
    if (!interaction)
      throw new DecisionNotDispatched('This integration interaction is no longer open.');
    try {
      validateQuestionAnswer(interaction, answer);
    } catch (error) {
      throw new DecisionNotDispatched(error);
    }
    if (!decisionIsSafety({ kind: 'respond', answer }))
      renewIntegrationDispatch(this.ctx.deps.db, projectId, op.id);
    if (interaction.kind === 'question' && answer.kind === 'question')
      this.ctx.integrations.history
        .secrets(op)
        .remember(
          interaction.questions.filter((q) => q.secret).flatMap((q) => answer.answers[q.id] ?? []),
        );
    const live = this.sessions.get(op.id);
    if (interaction.kind === 'question' && (isAsyncQuestion(interaction) || !live)) {
      const mailbox = new QuestionAnswers(this.ctx.deps.db, `integration.${op.id}`);
      const events: TimelineEvent[] = [];
      mailbox.accept(
        interaction,
        answer,
        (event) => events.push(event),
        timeline.state.turns.at(-1)?.id,
      );
      for (const event of events) await this.ctx.integrations.history.event(op, event);
      const input = mailbox.pending((await this.ctx.integrations.history.state(op)).state);
      // The answer continues the candidate that asked; a finished one only closes its card.
      if (input && CONTROLLED.includes(op.state)) {
        await this.deliver(op, input);
        mailbox.delivered();
      }
      return true;
    } else {
      if (!live)
        throw new DecisionNotDispatched(
          'The old approval expired; the current agent will request it again.',
        );
      const epoch = timeline.state.turns.at(-1)?.id;
      await live.session.respond(scoped.replace(`${live.worker}:`, ''), answer);
      if (interaction.kind === 'question')
        recordQuestionAcceptance(
          this.ctx.deps.db,
          `integration.${op.id}`,
          interaction,
          answer,
          epoch,
          decisionItemId(op.id, epoch, scoped),
        );
    }
    // Reload to avoid replacing a newly saved continuation with a historical snapshot.
    const current = live?.operation ?? this.ctx.integrations.store.find(projectId, op.id)!;
    await this.ctx.integrations.history.event(current, {
      t: 'interaction.closed',
      id: scoped,
      resolution: 'answered',
    });
    this.ctx.integrations.setRuntime(current, live ? 'running' : 'queued');
    return true;
  }

  async interrupt(projectId: string, taskId: string): Promise<void> {
    const saved = currentIntegration(this.ctx.integrations.store.all(projectId), taskId, [
      ...CONTROLLED,
      'ready',
    ]);
    if (!saved) return;
    resourcesFor(this.ctx.deps.db)?.stopOwner(projectId, `integration:${saved.id}`);
    const live = this.sessions.get(saved.id);
    const op = this.ctx.integrations.executing(saved.id) ?? live?.operation ?? saved;
    this.ctx.integrations.pause(op);
    this.ctx.queue.cancel(integrationQueueKey(op));
    await this.ctx.processes.stop(`verification-${op.id}`);
    this.ctx.integrations.service.interrupt(op.id);
    if (live) {
      try {
        await operationTimeout(
          live.session.interrupt(),
          5000,
          'Integration interrupt deadline exceeded',
        );
      } catch {
        this.ctx.deps.db.addEvent(projectId, 'task_interrupt_escalated', {
          task: taskId,
          integration: op.id,
        });
      }
      await this.ctx.processes.stop(live.worker);
      await live.session.close();
    }
    this.ctx.integrations.setRuntime(op, 'idle');
  }
}
