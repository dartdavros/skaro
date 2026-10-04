import { expect, it, vi } from 'vitest';
import { TurnControl } from './turn-control.ts';

it('settles the old task if interruption completes but the interrupt RPC fails', async () => {
  const turns = new TurnControl();
  turns.observe({ t: 'turn.started', turnId: 'old' });
  const resume = vi.fn();
  const ended = vi.fn();
  const switched = turns.resumeWithPermissions(
    async () => {
      const event = turns.observe({ t: 'turn.completed', turnId: 'old', outcome: 'interrupted' });
      expect(event).toHaveProperty('continuing', true);
      throw new Error('interrupt RPC failed');
    },
    resume,
    ended,
  );
  await expect(switched).rejects.toThrow('interrupt RPC failed');
  expect(resume).not.toHaveBeenCalled();
  expect(ended).toHaveBeenCalledWith({
    t: 'turn.completed',
    turnId: 'old',
    outcome: 'interrupted',
  });
});
