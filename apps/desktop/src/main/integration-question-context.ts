import { Timeline, type QuestionMessageReference, type TimelineEvent } from '@skaro/timeline';
import type { TaskRunEngine } from './task-run-engine';
import type { IntegrationOperation } from './integration-model';
import type { ResolverSession } from './integration-worker';
import type { QuestionCancellationContext } from './question-cancellation';

export async function integrationQuestionContext(
  ctx: TaskRunEngine,
  op: IntegrationOperation,
  live?: ResolverSession,
): Promise<QuestionCancellationContext> {
  const original = (await ctx.integrations.history.state(op)).state;
  const timeline = Timeline.restore({
    ...original,
    interactions: [...original.interactions],
    items: [...original.items],
    turns: original.turns.map((t) => ({ ...t })),
  });
  const events: TimelineEvent[] = [];
  return {
    db: ctx.deps.db,
    owner: `integration.${op.id}`,
    state: timeline.state,
    emit: (event) => {
      timeline.apply(event);
      events.push(event);
    },
    flush: async () => {
      for (const event of events.splice(0)) await ctx.integrations.history.event(op, event);
    },
    ...(live ? { interrupt: () => live.session.interrupt() } : {}),
  };
}

/** Only this candidate's displayed snapshots can retire its requests. */
export function integrationQuestionReferences(
  refs: QuestionMessageReference[] | undefined,
  id: string,
) {
  const prefix = `integration-${id}:`;
  return refs
    ?.filter((ref) => ref.id.startsWith(prefix))
    .map((ref) => {
      const question = JSON.parse(ref.request);
      question.id = question.id.slice(prefix.length);
      if (question.itemId?.startsWith(prefix))
        question.itemId = question.itemId.slice(prefix.length);
      return {
        id: ref.id.slice(prefix.length),
        request: JSON.stringify(question),
        epoch: ref.epoch?.startsWith(prefix) ? ref.epoch.slice(prefix.length) : ref.epoch,
      };
    });
}
