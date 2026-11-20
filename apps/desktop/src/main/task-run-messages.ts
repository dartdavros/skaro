import { QuestionAnswers } from './question-answers';
import { decisionItemId } from './decision-item-id';
import { resourcesFor } from './resource-execution';
import { stopOwnerMessages, CommandCancelled, queueOwnerMessage } from './owner-commands';
import { assertQuestionMessageAllowed, validateQuestionAnswer } from '@skaro/timeline';
import { isAsyncQuestion, type Interaction, type InteractionAnswer } from '@skaro/timeline';
import { ACCEPT_AS_IS, WAIT_CARD, acceptedBody } from './task-wait-card';
import { readSubject, updateSubject } from './task-subject';
import type { MessageInput } from '../shared/ipc';
import { withoutSecrets } from './session-log';
import { key, findTask } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import { trackRun } from './task-run-access';
import type { TaskRunEngine } from './task-run-engine';
import { stopBuiltinTask, requireTaskNotStopping } from './builtin-task-stop';
import { deliverTaskInput } from './task-input-transition';
import { prepareTaskFollowUp } from './task-follow-up';
import { terminalTaskHistory, retireTerminalTaskRequests } from './terminal-task-requests';
import { stopManagedTask } from './managed-task-stop';
import { supersedeQuestionInput } from './question-cancellation';
import { taskQuestionContext } from './question-cancel-handlers';
import { dispatchTaskReply } from './task-interaction-delivery';
import { DecisionNotDispatched } from './decision-not-dispatched';

/** messages: a focused part of the task-run controller. */
export class TaskRunMessages {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  async send(projectId: string, taskId: string, input: MessageInput): Promise<void> {
    const epoch = this.ctx.startup.cancellationEpoch(projectId, taskId);
    const requireCurrent = () => {
      if (this.ctx.closing || epoch !== this.ctx.startup.cancellationEpoch(projectId, taskId))
        throw new CommandCancelled();
    };
    if (await this.ctx.integrations.controls.send(projectId, taskId, input)) return;
    requireCurrent();
    let active = await this.ctx.history.restore(projectId, taskId);
    requireCurrent();
    if (!active) return this.ctx.scheduling.start(projectId, taskId, input, requireCurrent);
    active = await this.ctx.handoff.recover(active);
    requireCurrent();
    const task = findTask(await this.ctx.project(projectId).summary(), taskId);
    requireCurrent();
    retireTerminalTaskRequests(
      active.timeline.state,
      terminalTaskHistory(this.ctx.deps.db, task.status, active.run.id, task.archived),
      (event) => this.ctx.history.skaroEvent(active, event),
    );
    requireTaskNotStopping(active);
    if (!input.internal) {
      const answer = new QuestionAnswers(this.ctx.deps.db, `active.${active.run.id}`).pending(
        active.timeline.state,
      );
      input = prepareTaskFollowUp(
        this.ctx.continuation.execution(active),
        input,
        active.timeline.state,
        answer,
      );
    }
    input = await supersedeQuestionInput(taskQuestionContext(this.ctx, active), input);
    assertQuestionMessageAllowed(active.timeline.state, input.internal);
    await this.turn(active, input);
  }

  /** Joins the running turn, or starts a new one when a slot is free (it waits in the queue). */
  async turn(active: ActiveRun, input: MessageInput): Promise<void> {
    const epoch = active.deliveryEpoch;
    const requireCurrent = () => {
      requireTaskNotStopping(active);
      if (this.ctx.closing || epoch !== active.deliveryEpoch) throw new CommandCancelled();
    };
    requireCurrent();
    if (active.switching) throw new Error('The agent is being changed. Retry after the handoff.');
    const { projectId, taskId } = active;
    const working = active.timeline.state.status === 'working';
    if (working || this.ctx.scheduling.holdsSlot(projectId, taskId)) {
      await this.deliver(active, input);
    } else {
      await this.ctx.scheduling.enqueue(projectId, taskId, input, requireCurrent);
    }
  }

  /** Skaro's own message: the agent continues; the feed shows the decision, not this text. */
  async continueAfter(active: ActiveRun, text: string, decisionId: string): Promise<void> {
    // The owner's package decision also resumes runs created before execution intent existed.
    this.ctx.continuation.execution(active).start();
    // Skaro's own waiting card asked for this very step; it is answered by continuing.
    for (const open of active.timeline.state.interactions)
      if (open.id.startsWith(WAIT_CARD))
        this.ctx.history.skaroEvent(active, {
          t: 'interaction.closed',
          id: open.id,
          resolution: 'cancelled',
        });
    const commandId = `continue-c4-decision-${decisionId}-${this.ctx.continuation.execution(active).intentVersion()}`;
    queueOwnerMessage('task.send', active.projectId, active.taskId, {
      text,
      internal: true,
      commandId,
    });
  }

  /** Straight to the agent: only for a turn that holds its slot. */
  async deliver(active: ActiveRun, input: MessageInput): Promise<void> {
    const epoch = active.deliveryEpoch;
    const previous = active.delivery ?? Promise.resolve();
    const delivery = previous
      .catch(() => undefined)
      .then(() => deliverTaskInput(this.ctx, active, input, epoch));
    active.delivery = delivery;
    try {
      await delivery;
    } finally {
      if (active.delivery === delivery) active.delivery = undefined;
    }
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
    if (!active) throw new DecisionNotDispatched('The agent session has ended');
    return trackRun(active, () => this.answer(active, interactionId, answer));
  }

  private async answer(
    active: ActiveRun,
    interactionId: string,
    answer: InteractionAnswer,
  ): Promise<void> {
    if (interactionId.startsWith('coordinator:'))
      return this.ctx.incidents.decisions.answer(
        active.projectId,
        interactionId.slice('coordinator:'.length),
        answer,
        active.taskId,
      );
    const interaction = active.timeline.state.interactions.find((i) => i.id === interactionId);
    try {
      validateQuestionAnswer(interaction, answer);
    } catch (error) {
      throw new DecisionNotDispatched(error);
    }
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
    const turnId = active.timeline.state.turns.at(-1)?.id;
    if (
      interaction &&
      (await dispatchTaskReply(this.ctx, active, interaction, answer)) === 'native'
    )
      this.decision(active, interaction, answer, turnId);
  }

  /** The decision stays in the feed (and the log) after the card closes. */
  private decision(
    active: ActiveRun,
    interaction: Interaction,
    answer: InteractionAnswer,
    turnId: string | undefined,
  ): void {
    this.ctx.history.skaroEvent(active, {
      t: 'item.upsert',
      item: {
        id: decisionItemId(active.run.id, turnId, interaction.id),
        turnId: isAsyncQuestion(interaction) ? '' : (turnId ?? ''),
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
    this.decision(active, interaction, answer, active.timeline.state.turns.at(-1)?.id);
    const context = this.ctx.project(projectId);
    const task = await readSubject(context, taskId);
    await updateSubject(context, taskId, { body: acceptedBody(task.body) });
    this.ctx.changed(projectId, taskId);
    await this.ctx.results.criteriaChanged(projectId, taskId);
  }

  async interrupt(projectId: string, taskId: string): Promise<void> {
    resourcesFor(this.ctx.deps.db)?.stopOwner(projectId, `task:${taskId}`);
    if (this.ctx.handoff.changing(this.ctx.active.get(key(projectId, taskId))))
      throw new Error('Wait for the agent handoff to finish before stopping the task.');
    this.ctx.continuation.stop(projectId, taskId);
    const commands = stopOwnerMessages(projectId, taskId);
    // A task feed can address an integration resolver. Its interrupt acknowledgement does not
    // prove transport retirement, so a task-runtime stop must not certify that delivery.
    const integrationOwnsDelivery = this.ctx.integrations.store
      .all(projectId)
      .some(
        (op) =>
          !['applied', 'stale'].includes(op.state) &&
          (op.taskId === taskId || op.results.some((result) => result.taskId === taskId)),
      );
    this.ctx.startup.cancel(projectId, taskId);
    const k = key(projectId, taskId);
    this.ctx.queuedInputs.delete(k);
    const current = this.ctx.active.get(k) ?? (await this.ctx.history.restore(projectId, taskId));
    if (current) {
      current.deliveryEpoch++;
      current.builtinStartup?.abort(new CommandCancelled());
    }
    if (current?.run.agent === 'skaro')
      return stopBuiltinTask(this.ctx, current, integrationOwnsDelivery ? [] : commands);
    if (current) return stopManagedTask(this.ctx, current, commands, integrationOwnsDelivery);
    await this.ctx.architecture.stop(projectId, taskId);
    await this.ctx.integrations.controls.interrupt(projectId, taskId);
    if (this.ctx.queue.cancel(k)) {
      this.ctx.queuedInputs.delete(k);
      // A started task goes back to what its feed says; a new one was never running.
      const active = this.ctx.active.get(k);
      if (active) this.ctx.events.settleRuntime(active);
      else this.ctx.setRuntime(projectId, taskId, 'idle');
      return;
    }
    await this.ctx.active.get(k)?.session?.interrupt();
    const active = this.ctx.active.get(k);
    if (active) await this.ctx.sessions.detach(active);
  }

  async stopBackground(projectId: string, taskId: string, backgroundId: string): Promise<void> {
    await this.ctx.requireActive(projectId, taskId).session?.stopBackground(backgroundId);
  }
}
