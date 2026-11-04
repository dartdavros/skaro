import { randomUUID } from 'node:crypto';
import type { Interaction } from '@skaro/timeline';
import type { SecretQuestion, SkaroScope } from '@skaro/mcp-server';
import type { TaskRunEngine } from './task-run-engine';
import { taskTool } from './task-run-access';

export function secretInteraction(
  questions: SecretQuestion[],
): Extract<Interaction, { kind: 'question' }> {
  return {
    kind: 'question',
    id: `skaro-secret-${randomUUID()}`,
    delivery: 'async',
    questions: questions.map(({ id, header, question }) => ({
      id,
      header,
      text: question,
      multi: false,
      allowFreeText: true,
      secret: true,
      options: [],
    })),
  };
}

export function requestTaskSecret(
  ctx: TaskRunEngine,
  questions: SecretQuestion[],
  scope: SkaroScope,
) {
  return taskTool(ctx, scope, async () => {
    const active = ctx.requireActive(scope.projectId, scope.taskId!);
    const interaction = secretInteraction(questions);
    ctx.history.skaroEvent(active, { t: 'interaction.opened', interaction });
    ctx.history.flush(active);
    const session = active.session;
    const turn = active.timeline.state.turns.at(-1)?.id;
    // Let the MCP response leave first. Like native async questions, this card
    // persists through interruption; its private answer explicitly resumes the run.
    setImmediate(() => {
      if (
        !ctx.closing &&
        !active.switching &&
        session &&
        active.session === session &&
        active.timeline.state.turns.at(-1)?.id === turn &&
        active.timeline.state.interactions.some((item) => item.id === interaction.id)
      )
        void session
          .interrupt()
          .catch((error: unknown) => console.error('Protected input interrupt:', error));
    });
    return {
      text: JSON.stringify({
        state: 'waiting_for_secret',
        questionId: interaction.id,
        message:
          'Protected fields are open. End this turn and wait for their answer. Do not report missing credentials as an external blocker or request them in chat.',
      }),
    };
  });
}
