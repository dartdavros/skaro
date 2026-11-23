import { describe, expect, it } from 'vitest';
import { savedPlanStatus } from './chat-planning-status';
import { dialoguePlan, planningWorkspace } from './chat-planning-test-workspace';

describe('planning decisions and continuation with real storage', () => {
  it('publishes a completed draft at turn end without another agent turn or creating tasks', async () => {
    const w = await planningWorkspace();
    try {
      await w.engine.planning.prepare(w.live, dialoguePlan());
      const store = w.engine.planning.store(w.live);
      const event = {
        t: 'turn.completed' as const,
        turnId: 'stopped-too-early',
        outcome: 'done' as const,
      };
      w.engine.history.onEvent(w.live, event);
      w.engine.planningContinuation.onEvent(w.live, event);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await w.engine.planningContinuation.settled(w.live);
      expect(store.get('dialogue')!.state).toBe('complete');
      const [card] = w.engine.proposals.proposals(w.live);
      expect(card?.proposal.type === 'plan' && card.proposal.tasks.length).toBe(75);
      expect(card?.state).toBe('pending');
      await w.engine.planning.propose(w.live, { key: 'dialogue' });
      expect(w.engine.proposals.proposals(w.live)).toHaveLength(1);
      expect(w.live.session).toBeUndefined();
      expect((await w.store.load()).tasks).toHaveLength(0);
    } finally {
      await w.close();
    }
  });
  it('keeps the whole plan unproposed until all specifications are ready and treats superseded specs as blockers', async () => {
    const w = await planningWorkspace();
    try {
      const pending = await w.store.createSpec({
        title: 'Дополнительное правило',
        status: 'proposed',
      });
      w.engine.project(w.live.projectId).invalidate();
      const args = dialoguePlan();
      args.milestones[0]!.tasks[0]!.spec = pending.id;
      await w.engine.planning.prepare(w.live, args);
      await w.engine.planning.propose(w.live, { key: 'dialogue' });
      let plan = w.engine.planning.store(w.live).get('dialogue')!;
      expect(
        savedPlanStatus(plan, w.live.timeline.state.items, await w.store.load()).counts,
      ).toMatchObject({ proposed: 0, unproposed: 75 });
      expect(plan.state).toBe('waiting');
      await w.store.setSpecStatus(pending.id, 'superseded');
      w.engine.project(w.live.projectId).invalidate();
      expect((await w.engine.planning.propose(w.live, { key: 'dialogue' })).isError).toBe(true);
      plan = w.engine.planning.store(w.live).get('dialogue')!;
      expect(plan.state).toBe('blocked');
    } finally {
      await w.close();
    }
  });
  it('waits for real specification acceptance and resumes when it is accepted', async () => {
    const w = await planningWorkspace();
    try {
      await w.store.setSpecStatus('0001', 'proposed');
      w.engine.project(w.live.projectId).invalidate();
      await w.engine.planning.prepare(w.live, dialoguePlan());
      await w.engine.planning.propose(w.live, { key: 'dialogue' });
      let plan = w.engine.planning.store(w.live).get('dialogue')!;
      expect(plan.state).toBe('waiting');
      expect(w.engine.proposals.proposals(w.live)).toHaveLength(0);
      await w.store.setSpecStatus('0001', 'accepted');
      w.engine.project(w.live.projectId).invalidate();
      await w.engine.planning.propose(w.live, { key: 'dialogue' });
      plan = w.engine.planning.store(w.live).get('dialogue')!;
      expect(
        savedPlanStatus(plan, w.live.timeline.state.items, await w.store.load()).counts.proposed,
      ).toBe(75);
    } finally {
      await w.close();
    }
  });

  it('prevents cancelled or interrupted work from restarting', async () => {
    const w = await planningWorkspace();
    try {
      await w.engine.planning.prepare(w.live, dialoguePlan());
      w.engine.planningContinuation.schedule(w.live);
      w.engine.planningContinuation.stop(w.live, 'Владелец остановил выполнение');
      expect(w.live.planningTimer).toBeUndefined();
      expect(w.engine.planning.store(w.live).get('dialogue')!.state).toBe('paused');
      expect((await w.engine.planning.propose(w.live, { key: 'dialogue' })).isError).toBe(true);
      await w.engine.planning.control(w.live, {
        key: 'dialogue',
        action: 'cancel',
        reason: 'Владелец отменил поручение',
      });
      expect(w.engine.planning.store(w.live).current()).toBeUndefined();
      expect(
        (
          await w.engine.planning.control(w.live, {
            key: 'dialogue',
            action: 'resume',
            reason: 'Попытка возобновления',
          })
        ).isError,
      ).toBe(true);
    } finally {
      await w.close();
    }
  });
});
