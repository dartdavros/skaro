import { randomUUID } from 'node:crypto';
import { TASK_SECRET_QUESTION_PREFIX, type Interaction } from '@skaro/timeline';
import type { SecretQuestion, SkaroScope } from '@skaro/mcp-server';
import type { TaskRunEngine } from './task-run-engine';
import { taskTool } from './task-run-access';

export { TASK_SECRET_QUESTION_PREFIX };

export function secretInteraction(
  questions: SecretQuestion[],
): Extract<Interaction, { kind: 'question' }> {
  return {
    kind: 'question',
    id: `${TASK_SECRET_QUESTION_PREFIX}${randomUUID()}`,
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
    return {
      text: JSON.stringify({
        state: 'waiting_for_secret',
        questionId: interaction.id,
        message:
          'Protected fields are open. Continue independent work. Use the protected answer for the steps requiring the credential.',
      }),
    };
  });
}
