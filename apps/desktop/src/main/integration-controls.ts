import {
  isAsyncQuestion,
  validateQuestionAnswer,
  assertQuestionMessageAllowed,
  questionMessageNote,
  withSkaroNote,
  type InteractionAnswer,
} from '@skaro/timeline';
import type { MessageInput } from '../shared/ipc';
import { resourcesFor } from './resource-execution';
import type { TaskRunEngine } from './task-run-engine';
import type { ResolverSession } from './integration-worker';
import { QuestionAnswers } from './question-answers';
import { hasOwnerCommand } from './owner-command-history';
import { renewIntegrationDispatch, requireIntegrationDispatch } from './integration-dispatch-fence';
import { decisionIsSafety } from './decision-authority';
import type { TimelineEvent } from '@skaro/timeline';
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
    const op = this.current(projectId, taskId);
    if (!op) return false;
    await this.deliver(op, input, !input.internal);
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
    const timeline = (await this.ctx.integrations.history.state(op)).state;
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
    if (!interaction) throw new Error('This integration interaction is no longer open.');
    validateQuestionAnswer(interaction, answer);
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
        throw new Error('The old approval expired; the current agent will request it again.');
      await live.session.respond(scoped.replace(`${live.worker}:`, ''), answer);
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
    const saved = this.current(projectId, taskId);
    if (!saved) return;
    resourcesFor(this.ctx.deps.db)?.stopOwner(projectId, `integration:${saved.id}`);
    const live = this.sessions.get(saved.id);
    const op = this.ctx.integrations.executing(saved.id) ?? live?.operation ?? saved;
    this.ctx.integrations.pause(op);
    this.ctx.queue.cancel(integrationQueueKey(op));
    await this.ctx.processes.stop(`verification-${op.id}`);
    this.ctx.integrations.service.interrupt(op.id);
    await live?.session.interrupt();
    await live?.session.close();
    this.ctx.integrations.setRuntime(op, 'idle');
  }
}
