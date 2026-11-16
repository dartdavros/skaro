import type { CoordinationBlocker } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { cancelIncidentApproval } from './incident-feed';

/** Upgrade the old controller-generated empty form through canonical cancellation. */
export async function retireLegacyIncidentQuestion(ctx: TaskRunEngine, row: CoordinationBlocker) {
  const id = row.protocol?.decisionId;
  if (!id || ctx.deps.db.coordination.decisions.get(row.projectId, id)?.kind !== 'question') return;
  for (const subscription of row.protocol!.subscriptions) {
    const active = await ctx.history.restore(row.projectId, subscription.taskId);
    const question = active?.timeline.state.interactions.find((i) => i.id === `coordinator:${id}`);
    if (
      question?.kind === 'question' &&
      question.questions.some(
        (q) =>
          !q.options.length &&
          q.text.includes('Автоматическое восстановление недоступно. Укажите решение'),
      )
    ) {
      await cancelIncidentApproval(ctx, row, id, 'legacy_incident_question_replaced');
      return;
    }
  }
}
