import { QuestionAnswers } from './question-answers';
import { cancelOwnerMessages, CommandCancelled } from './owner-commands';
import { withSkaroNote, assertQuestionsAnswered, validateQuestionAnswer } from '@skaro/timeline';
import { isAsyncQuestion, type Interaction, type InteractionAnswer } from '@skaro/timeline';
import { ACCEPT_AS_IS, WAIT_CARD, acceptedBody } from './task-wait-card';
import { readSubject, updateSubject } from './task-subject';
import type { MessageInput } from '../shared/ipc';
import { withoutSecrets } from './session-log';
import { key } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import { trackRun } from './task-run-access';
import type { TaskRunEngine } from './task-run-engine';

/** messages: a focused part of the task-run controller. */
export class TaskRunMessages {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  async send(projectId: string, taskId: string, input: MessageInput): Promise<void> {
    if (await this.ctx.integrations.controls.send(projectId, taskId, input)) return;
    let active = await this.ctx.history.restore(projectId, taskId);
    if (!active) return this.ctx.scheduling.start(projectId, taskId, input);
    active = await this.ctx.handoff.recover(active);
    await this.turn(active, input);
  }

  /** Joins the running turn, or starts a new one when a slot is free (it waits in the queue). */
  async turn(active: ActiveRun, input: MessageInput): Promise<void> {
    if (active.switching) throw new Error('The agent is being changed. Retry after the handoff.');
    const { projectId, taskId } = active;
    const working = active.timeline.state.status !== 'idle';
    if (working || this.ctx.scheduling.holdsSlot(projectId, taskId)) {
      await this.deliver(active, input);
    } else {
      await this.ctx.scheduling.enqueue(projectId, taskId, input);
    }
  }

  /** Skaro's own message: the agent continues; the feed shows the decision, not this text. */
  async continueAfter(active: ActiveRun, text: string): Promise<void> {
    active.internalInputs.add(text.trim());
    // Skaro's own waiting card asked for this very step; it is answered by continuing.
    for (const open of active.timeline.state.interactions)
      if (open.id.startsWith(WAIT_CARD))
        this.ctx.history.skaroEvent(active, {
          t: 'interaction.closed',
          id: open.id,
          resolution: 'cancelled',
        });
    await this.turn(active, { text });
  }

  /** Straight to the agent: only for a turn that holds its slot. */
  async deliver(active: ActiveRun, input: MessageInput): Promise<void> {
    input = active.secrets.input(input);
    assertQuestionsAnswered(active.timeline.state);
    const session = await this.ctx.sessions.attach(active);
    assertQuestionsAnswered(active.timeline.state);
    if (input.commandId && this.ctx.deps.db.commands.get(input.commandId)?.state === 'cancelled')
      throw new CommandCancelled();
    const message = input.commandId
      ? { ...input, text: withSkaroNote(`command_id: ${input.commandId}`, input.text) }
      : input;
    if (active.timeline.state.status === 'idle') await session.send(message);
    else await session.steer(message);
  }

  async respond(
    projectId: string,
    taskId: string,
    interactionId: string,
    answer: InteractionAnswer,
  ): Promise<void> {
    if (await this.ctx.integrations.controls.respond(projectId, taskId, interactionId, answer))
      return;
    const active = await this.ctx.history.restore(projectId, taskId);
    if (!active) throw new Error('The agent session has ended');
    return trackRun(active, () => this.answer(active, interactionId, answer));
  }

  private async answer(
    active: ActiveRun,
    interactionId: string,
    answer: InteractionAnswer,
  ): Promise<void> {
    const interaction = active.timeline.state.interactions.find((i) => i.id === interactionId);
    validateQuestionAnswer(interaction, answer);
    if (interaction?.kind === 'question' && answer.kind === 'question')
      active.secrets.remember(
        interaction.questions.filter((q) => q.secret).flatMap((q) => answer.answers[q.id] ?? []),
      );
    if (
      interaction?.kind === 'question' &&
      interaction.id.startsWith(WAIT_CARD) &&
      answer.kind === 'question' &&
      answer.answers['criteria']?.includes(ACCEPT_AS_IS)
    )
      return this.acceptAsIs(active, interaction, answer);
    if (
      interaction?.kind === 'question' &&
      (isAsyncQuestion(interaction) ||
        !active.session ||
        !active.timeline.state.turns.some((turn) => !turn.outcome))
    ) {
      const mailbox = new QuestionAnswers(this.ctx.deps.db, `active.${active.run.id}`);
      mailbox.accept(interaction, answer, (event) => this.ctx.history.skaroEvent(active, event));
      mailbox.queue('task.send', active.projectId, active.taskId, active.timeline.state);
      return;
    } else {
      if (!active.session) throw new Error('The agent session has ended');
      const nativeId = active.run.previousRunId
        ? interactionId.replace(`${active.run.id}:`, '')
        : interactionId;
      await active.session.respond(nativeId, answer);
    }
    if (interaction) this.decision(active, interaction, answer);
  }

  /** The decision stays in the feed (and the log) after the card closes. */
  private decision(active: ActiveRun, interaction: Interaction, answer: InteractionAnswer): void {
    this.ctx.history.skaroEvent(active, {
      t: 'item.upsert',
      item: {
        id: `skaro-decision-${interaction.id}`,
        turnId: isAsyncQuestion(interaction) ? '' : (active.timeline.state.turns.at(-1)?.id ?? ''),
        kind: 'decision',
        interaction,
        answer: withoutSecrets(interaction, answer),
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'decision', ref: interaction.id },
      },
    });
  }

  /** The owner accepts the result without the unmet criteria: Skaro ticks them, as by hand. */
  private async acceptAsIs(
    active: ActiveRun,
    interaction: Interaction,
    answer: InteractionAnswer,
  ): Promise<void> {
    const { projectId, taskId } = active;
    this.ctx.history.skaroEvent(active, {
      t: 'interaction.closed',
      id: interaction.id,
      resolution: 'answered',
    });
    this.decision(active, interaction, answer);
    const context = this.ctx.project(projectId);
    const task = await readSubject(context, taskId);
    await updateSubject(context, taskId, { body: acceptedBody(task.body) });
    this.ctx.changed(projectId, taskId);
    await this.ctx.results.criteriaChanged(projectId, taskId);
  }

  async interrupt(projectId: string, taskId: string): Promise<void> {
    cancelOwnerMessages(projectId, taskId);
    this.ctx.startup.delivered(projectId, taskId);
    await this.ctx.integrations.controls.interrupt(projectId, taskId);
    const k = key(projectId, taskId);
    if (this.ctx.handoff.changing(this.ctx.active.get(k)))
      throw new Error('Wait for the agent handoff to finish before stopping the task.');
    if (this.ctx.queue.cancel(k)) {
      this.ctx.queuedInputs.delete(k);
      // A started task goes back to what its feed says; a new one was never running.
      const active = this.ctx.active.get(k);
      if (active) this.ctx.events.settleRuntime(active);
      else this.ctx.setRuntime(projectId, taskId, 'idle');
      return;
    }
    await this.ctx.active.get(k)?.session?.interrupt();
  }

  async stopBackground(projectId: string, taskId: string, backgroundId: string): Promise<void> {
    await this.ctx.requireActive(projectId, taskId).session?.stopBackground(backgroundId);
  }
}
