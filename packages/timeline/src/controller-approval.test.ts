import { expect, it } from 'vitest';
import { Timeline } from './state.ts';
import { persistsAfterTurn } from './async-question.ts';
import type { Interaction } from './interactions.ts';

it('retains a durable controller approval across terminal events, but expires native permissions', () => {
  const approval: Interaction = {
    kind: 'approval',
    id: 'coordinator:decision',
    delivery: 'async',
    action: { type: 'other', title: 'start_environment' },
    choices: ['allow_once', 'deny'],
  };
  const timeline = new Timeline();
  timeline.apply({ t: 'turn.started', turnId: 'turn' });
  timeline.apply({ t: 'interaction.opened', interaction: approval });
  timeline.apply({
    t: 'interaction.opened',
    interaction: { ...approval, id: 'native', delivery: undefined },
  });
  timeline.apply({ t: 'turn.completed', turnId: 'turn', outcome: 'interrupted' });
  expect(timeline.state.interactions).toEqual([approval]);
  expect(persistsAfterTurn(approval)).toBe(true);
  timeline.apply({ t: 'interaction.closed', id: approval.id, resolution: 'answered' });
  expect(timeline.state.interactions).toEqual([]);
});
