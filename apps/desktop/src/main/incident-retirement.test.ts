import { expect, it } from 'vitest';
import { incidentSubscribersFinished } from './incident-retirement';

it('retires obsolete incidents only after every shared subscriber is terminal', () => {
  const ids = new Set(['completed', 'peer']);
  const completed = { id: 'completed', status: 'done', archived: false };
  const peer = { id: 'peer', status: 'in_progress', archived: false };
  expect(incidentSubscribersFinished(ids, [completed, peer])).toBe(false);
  expect(incidentSubscribersFinished(ids, [completed, { ...peer, status: 'cancelled' }])).toBe(
    true,
  );
  expect(incidentSubscribersFinished(ids, [completed, { ...peer, archived: true }])).toBe(true);
  expect(incidentSubscribersFinished(ids, [completed])).toBe(false);
  expect(incidentSubscribersFinished(new Set(), [completed])).toBe(false);
});
