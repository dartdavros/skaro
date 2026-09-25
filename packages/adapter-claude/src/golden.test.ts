import { goldenCases, updateGolden } from '@skaro/timeline/golden';
import { describe, expect, it } from 'vitest';
import { ClaudeProjector } from './projector.ts';

// SKARO_UPDATE_GOLDEN=1 rebuilds canonical.jsonl and timeline.json after an intended change.
const update = process.env['SKARO_UPDATE_GOLDEN'] === '1';

describe('claude golden sessions', () => {
  const cases = goldenCases('claude', (ctx, emit) => new ClaudeProjector(ctx, emit));
  if (update) cases.forEach(updateGolden);

  it.each(cases.map((c) => [c.scenario, c] as const))(
    '%s replays into the recorded events',
    (_, c) => {
      expect(c.actual).toEqual(c.expected);
    },
  );

  it.each(cases.map((c) => [c.scenario, c] as const))(
    '%s assembles the recorded timeline',
    (_, c) => {
      expect(c.actualTimeline).toEqual(c.expectedTimeline);
    },
  );

  it('never loses an event to an adapter error', () => {
    for (const c of cases) {
      const broken = c.actual.filter(
        (line) => line.includes('"kind":"unknown"') && line.includes('"error"'),
      );
      expect(broken, c.scenario).toEqual([]);
    }
  });
});
