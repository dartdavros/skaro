import { isAsyncQuestion, asyncQuestionInput, type InteractionAnswer } from '@skaro/timeline';
import type { MessageInput } from '../shared/ipc';
import { withoutSecrets } from './session-log';
import { key } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';

/** messages: a focused part of the task-run controller. */
export class TaskRunMessages {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  async send(projectId: string, taskId: string, input: MessageInput): Promise<void> {
    const k = key(projectId, taskId);
    const active = this.ctx.active.get(k) ?? (await this.ctx.history.restore(projectId, taskId));
    if (!active) return this.ctx.scheduling.start(projectId, taskId, input);
    await this.deliver(active, input);
  }

  async deliver(active: ActiveRun, input: MessageInput): Promise<void> {
    const session = await this.ctx.sessions.attach(active);
    if (active.timeline.state.status === 'idle') await session.send(input);
    else await session.steer(input);
  }

  async respond(
    projectId: string,
    taskId: string,
    interactionId: string,
    answer: InteractionAnswer,
  ): Promise<void> {
    const active =
      this.ctx.active.get(key(projectId, taskId)) ??
      (await this.ctx.history.restore(projectId, taskId));
    if (!active) throw new Error('The agent session has ended');
    const interaction = active.timeline.state.interactions.find((i) => i.id === interactionId);
    if (isAsyncQuestion(interaction)) {
      await this.deliver(active, asyncQuestionInput(interaction, answer));
      this.ctx.history.skaroEvent(active, {
        t: 'interaction.closed',
        id: interactionId,
        resolution: 'answered',
      });
    } else {
      if (!active.session) throw new Error('The agent session has ended');
      await active.session.respond(interactionId, answer);
    }
    if (!interaction) return;
    // The decision stays in the feed (and the log) after the card closes.
    this.ctx.history.skaroEvent(active, {
      t: 'item.upsert',
      item: {
        id: `skaro-decision-${interactionId}`,
        turnId: isAsyncQuestion(interaction) ? '' : (active.timeline.state.turns.at(-1)?.id ?? ''),
        kind: 'decision',
        interaction,
        answer: withoutSecrets(interaction, answer),
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'decision', ref: interactionId },
      },
    });
  }

  async interrupt(projectId: string, taskId: string): Promise<void> {
    const k = key(projectId, taskId);
    if (this.ctx.queue.cancel(k)) {
      this.ctx.firstInputs.delete(k);
      this.ctx.setRuntime(projectId, taskId, 'idle');
      return;
    }
    await this.ctx.active.get(k)?.session?.interrupt();
  }

  async stopBackground(projectId: string, taskId: string, backgroundId: string): Promise<void> {
    await this.ctx.requireActive(projectId, taskId).session?.stopBackground(backgroundId);
  }
}
