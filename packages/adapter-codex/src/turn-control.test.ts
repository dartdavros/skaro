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

it('drops active-only steering when completion wins the serialized command boundary', async () => {
  const turns = new TurnControl();
  turns.observe({ t: 'turn.started', turnId: 'original' });
  let release!: () => void;
  const earlier = turns.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await Promise.resolve();
  const deliveries: string[] = [];
  const update = turns.steer(
    true,
    async (id) => {
      deliveries.push(`steer:${id}`);
    },
    async () => {
      deliveries.push('start');
    },
  );
  turns.observe({ t: 'turn.completed', turnId: 'original', outcome: 'done' });
  release();
  await Promise.all([earlier, update]);
  expect(deliveries).toEqual([]);
  expect(turns.active).toBeUndefined();
});

it('steers the current turn without granting permission to start one, and preserves ordinary fallback', async () => {
  const turns = new TurnControl();
  const deliveries: string[] = [];
  const deliver = async (id: string) => {
    deliveries.push(`steer:${id}`);
  };
  const start = async () => {
    deliveries.push('start');
  };
  await turns.steer(true, deliver, start);
  expect(deliveries).toEqual([]);
  turns.observe({ t: 'turn.started', turnId: 'active' });
  await turns.steer(true, deliver, start);
  expect(deliveries).toEqual(['steer:active']);
  turns.observe({ t: 'turn.completed', turnId: 'active', outcome: 'done' });
  await turns.steer(false, deliver, start);
  expect(deliveries).toEqual(['steer:active', 'start']);
});
