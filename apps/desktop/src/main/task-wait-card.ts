import type { Interaction, TimelineState } from '@skaro/timeline';
import { taskSections, toggleCriterion } from './task-body';

/** Skaro's own question when the agent stopped without asking through a card. */
export const WAIT_CARD = 'skaro-wait-';
export const ACCEPT_AS_IS = 'Принять как есть';
const FINISH = 'Доделать';

type Question = Extract<Interaction, { kind: 'question' }>;

/**
 * The turn ended, the task is not accepted and no question card is open: the agent waits for the
 * owner, often with a question in plain text that no card shows. Skaro shows one itself. After a
 * refused submission it offers the unmet criteria; otherwise it asks for the reply the agent awaits.
 */
export function waitCard(runId: string, body: string, timeline: TimelineState): Question {
  const lastTurn = timeline.turns.at(-1)?.id;
  const submitted = timeline.items.some(
    (item) => item.turnId === lastTurn && item.kind === 'tool' && item.name === 'submit_result',
  );
  const unmet = taskSections(body)
    .criteria.map((criterion, index) => ({ ...criterion, number: index + 1 }))
    .filter((criterion) => !criterion.done);
  const id = `${WAIT_CARD}${runId}-${lastTurn ?? Date.now()}`;
  if (submitted && unmet.length)
    return {
      kind: 'question',
      id,
      delivery: 'async',
      questions: [
        {
          id: 'criteria',
          header: 'Критерии',
          text: `Агент сдал задачу, но не выполнены критерии ${unmet.map((c) => c.number).join(', ')}. Принять задачу как есть?`,
          multi: false,
          allowFreeText: true,
          options: [
            {
              label: ACCEPT_AS_IS,
              description: `Skaro отметит критерии ${unmet.map((c) => c.number).join(', ')} выполненными и переведёт задачу на приёмку.`,
            },
            { label: FINISH, description: 'Агент продолжит работу над невыполненными критериями.' },
          ],
        },
      ],
    };
  return {
    kind: 'question',
    id,
    delivery: 'async',
    questions: [
      {
        id: 'reply',
        header: 'Ответ',
        text: 'Агент остановился и ждёт вашего ответа на сообщение выше.',
        multi: false,
        allowFreeText: true,
        options: [],
      },
    ],
  };
}

/** "Принять как есть": every unmet criterion of the card is ticked as the owner's decision. */
export function acceptedBody(body: string): string {
  let next = body;
  taskSections(body).criteria.forEach((criterion, index) => {
    if (!criterion.done) next = toggleCriterion(next, index);
  });
  return next;
}

/** A pending proposal card (an architecture package, a plan) already asks the owner. */
export function awaitsDecision(timeline: TimelineState): boolean {
  return timeline.items.some((item) => item.kind === 'proposal' && item.state === 'pending');
}
