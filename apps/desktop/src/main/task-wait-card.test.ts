import { expect, it } from 'vitest';
import type { TimelineState } from '@skaro/timeline';
import { ACCEPT_AS_IS, acceptedBody, awaitsDecision, waitCard } from './task-wait-card';
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
  const card = waitCard('run', body, state([submit]));
  expect(card.questions[0]).toMatchObject({ id: 'criteria', allowFreeText: true });
  expect(card.questions[0]!.text).toContain('2, 3');
  expect(card.questions[0]!.options.map((option) => option.label)).toContain(ACCEPT_AS_IS);
  expect(card.delivery).toBe('async');
});

it('asks for a free reply when the agent stopped without submitting', () => {
  const card = waitCard('run', body, state([]));
  expect(card.questions[0]).toMatchObject({ id: 'reply', allowFreeText: true, options: [] });
  // A submission of an earlier turn says nothing about this stop.
  const earlier = waitCard('run', body, state([{ ...submit, turnId: 'older' }]));
  expect(earlier.questions[0]!.id).toBe('reply');
});

it('accepting as is ticks only the unmet criteria', () => {
  expect(taskSections(acceptedBody(body)).criteria.every((c) => c.done)).toBe(true);
  expect(acceptedBody(acceptedBody(body))).toBe(acceptedBody(body));
});

it('leaves the question to a pending proposal card', () => {
  expect(awaitsDecision(state([{ kind: 'proposal', state: 'pending' }]))).toBe(true);
  expect(awaitsDecision(state([{ kind: 'proposal', state: 'applied' }]))).toBe(false);
});
