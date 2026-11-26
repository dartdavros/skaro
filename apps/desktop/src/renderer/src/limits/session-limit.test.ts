import { expect, it } from 'vitest';
import { limitWindow } from '@skaro/timeline';
import { sessionLimit } from './session-limit';

it('expires yesterday’s warning even when the weekly reset is still in the future', () => {
  const checkedAt = '2026-11-25T14:14:23Z';
  const windows = [limitWindow('seven_day', 97, '2026-11-30T05:26:40Z')];
  expect(sessionLimit({ checkedAt, windows }, Date.parse(checkedAt))?.state).toBe('warning');
  expect(sessionLimit({ checkedAt, windows }, Date.parse(checkedAt) + 86_400_000)).toBeUndefined();
  expect(sessionLimit(undefined, Date.now())).toBeUndefined();
});

it('uses the most restrictive unexpired window and clears on a fresh normal reading', () => {
  const checkedAt = new Date().toISOString();
  const now = Date.parse(checkedAt);
  const normal = limitWindow('seven_day', 30, null);
  const exhausted = limitWindow('five_hour', 100, new Date(now + 1000).toISOString());
  expect(sessionLimit({ checkedAt, windows: [normal, exhausted] }, now)?.state).toBe('exhausted');
  expect(sessionLimit({ checkedAt, windows: [normal, exhausted] }, now + 1000)).toBeUndefined();
  expect(sessionLimit({ checkedAt, windows: [normal] }, now)).toBeUndefined();
  expect(
    sessionLimit({ checkedAt, reached: true, windows: [normal, exhausted] }, now + 1000),
  ).toBeUndefined();
});
