import { expect, it } from 'vitest';
import { assertQuestionsAnswered, Timeline, type TimelineState } from '@skaro/timeline';
import {
  ACCEPT_AS_IS,
  acceptedBody,
  awaitsDecision,
  isLegacyWaitCard,
  WAIT_CARD,
  waitCard,
} from './task-wait-card';
import { taskSections } from './task-body';

const body = '## Критерии приёмки\n- [x] Первый\n- [ ] Второй\n- [ ] Третий\n';
const state = (items: unknown[]) =>
  ({
    items,
    turns: [{ id: 'turn', outcome: 'done' }],
    interactions: [],
  }) as unknown as TimelineState;
const submit = { kind: 'tool', name: 'submit_result', turnId: 'turn' };

it('offers the unmet criteria after a refused submission', () => {
  const card = waitCard('run', body, state([submit]))!;
  expect(card.questions[0]).toMatchObject({ id: 'criteria', allowFreeText: true });
  expect(card.questions[0]!.text).toContain('2, 3');
  expect(card.questions[0]!.options.map((option) => option.label)).toContain(ACCEPT_AS_IS);
  expect(card.delivery).toBe('async');
});

it('does not invent a question when the agent stopped without submitting', () => {
  expect(waitCard('run', body, state([]))).toBeUndefined();
  // A submission of an earlier turn says nothing about this stop.
  expect(waitCard('run', body, state([{ ...submit, turnId: 'older' }]))).toBeUndefined();
});

it('leaves tools available between accepting architecture and the next turn starting', () => {
  const timeline = Timeline.from([
    { t: 'turn.started', turnId: 'previous' },
    { t: 'turn.completed', turnId: 'previous', outcome: 'done' },
  ]);
  // The continuation has been sent, but its native turn.started event has not arrived yet.
  const card = waitCard('run', body, timeline.state);
  if (card) timeline.apply({ t: 'interaction.opened', interaction: card });
  expect(() => assertQuestionsAnswered(timeline.state)).not.toThrow();
  timeline.apply({ t: 'turn.started', turnId: 'continued' });
  expect(() => assertQuestionsAnswered(timeline.state)).not.toThrow();
});

it('retires only the old generic wait cards and preserves real owner decisions', () => {
  const legacy = {
    kind: 'question' as const,
    id: `${WAIT_CARD}run-turn`,
    delivery: 'async' as const,
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
  expect(isLegacyWaitCard(legacy)).toBe(true);
  expect(isLegacyWaitCard({ ...legacy, id: 'agent-question' })).toBe(false);
  const criteria = waitCard('run', body, state([submit]))!;
  expect(isLegacyWaitCard(criteria)).toBe(false);
  const timeline = Timeline.from([
    { t: 'interaction.opened', interaction: legacy },
    { t: 'interaction.opened', interaction: criteria },
  ]);
  for (const interaction of [...timeline.state.interactions])
    if (isLegacyWaitCard(interaction))
      timeline.apply({ t: 'interaction.closed', id: interaction.id, resolution: 'cancelled' });
  expect(timeline.state.interactions).toEqual([criteria]);
  expect(() => assertQuestionsAnswered(timeline.state)).toThrow('Answer the open questions');
});

it('accepting as is ticks only the unmet criteria', () => {
  expect(taskSections(acceptedBody(body)).criteria.every((c) => c.done)).toBe(true);
  expect(acceptedBody(acceptedBody(body))).toBe(acceptedBody(body));
});

it('leaves the question to a pending proposal card', () => {
  expect(awaitsDecision(state([{ kind: 'proposal', state: 'pending' }]))).toBe(true);
  expect(awaitsDecision(state([{ kind: 'proposal', state: 'applied' }]))).toBe(false);
});
