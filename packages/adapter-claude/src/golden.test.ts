import { goldenCases } from '@skaro/timeline/golden';
import { describe, expect, it } from 'vitest';
import { ClaudeProjector } from './projector.ts';

describe('Claude golden sessions', () => {
  const cases = goldenCases('claude', (ctx, emit) => new ClaudeProjector(ctx, emit));

  it.each(cases.map((c) => [c.scenario, c] as const))(
    '%s replays into the recorded timeline',
    (_, c) => {
      expect(c.actual).toEqual(c.expected);
    },
  );

  it('never loses an event to an adapter error', () => {
    for (const c of cases) {
      const unknown = c.actual.filter(
        (line) => line.includes('"kind":"unknown"') && line.includes('"error"'),
      );
      expect(unknown, c.scenario).toEqual([]);
    }
  });
});
