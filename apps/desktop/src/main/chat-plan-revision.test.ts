import { expect, it } from 'vitest';
import { planningWorkspace, dialoguePlan } from './chat-planning-test-workspace';
import { reviseChatPlan } from './chat-plan-revision';
import { PlanJournal } from './chat-plan-journal';

it('revises a pending draft without creating tasks, supersedes its old approval and restores the same revision once', async () => {
  const w = await planningWorkspace();
  try {
    const original = dialoguePlan();
    await w.engine.planning.prepare(w.live, original);
    const savedOriginal = w.engine.planning.store(w.live).get(original.key)!;
    await w.engine.planning.propose(w.live, { key: original.key });
    const old = w.engine.proposals.proposals(w.live).at(-1)!;
    const revised = {
      ...original,
      title: 'План без лишней задачи',
      expectedTotal: original.expectedTotal - 1,
      milestones: original.milestones.map((m, i) =>
        i ? m : { ...m, tasks: m.tasks.slice(0, -1) },
      ),
      reason: 'Владелец исключил лишнюю работу',
    };
    // No requirement is removed accidentally: explicitly cover the same requirements with the remaining task.
    const first = revised.milestones[0]!;
    first.tasks[0] = { ...first.tasks[0]!, requirements: first.requirements };
    expect((await reviseChatPlan(w.engine, w.live, revised)).isError).not.toBe(true);
    const current = w.engine.proposals.proposals(w.live).filter((p) => p.state === 'pending');
    expect(current).toHaveLength(1);
    expect(current[0]!.id).not.toBe(old.id);
    expect(current[0]!.proposal.type === 'plan' && current[0]!.proposal.tasks).toHaveLength(
      revised.expectedTotal,
    );
    expect(w.live.timeline.state.items.find((i) => i.id === old.id)).toMatchObject({
      state: 'superseded',
    });
    expect((await w.store.load()).tasks).toEqual([]);
    await expect(
      w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, old.id, { action: 'apply' }),
    ).rejects.toThrow('decision_stale');
    // A committed revision must repair a crash before the separate draft setting was published.
    w.engine.planning.store(w.live).put(savedOriginal);
    new PlanJournal(w.engine, w.live).restore();
    await reviseChatPlan(w.engine, w.live, revised);
    expect(w.engine.proposals.proposals(w.live).filter((p) => p.state === 'pending')).toHaveLength(
      1,
    );
    expect(w.engine.planning.store(w.live).get(original.key)!.revision).toBe(1);
    expect(w.engine.planning.store(w.live).current()).toBeUndefined();
    w.engine.planning
      .store(w.live)
      .put({ ...w.engine.planning.store(w.live).get(original.key)!, state: 'paused' });
    new PlanJournal(w.engine, w.live).restore();
    expect(w.engine.planning.store(w.live).get(original.key)!.state).toBe('paused');
  } finally {
    await w.close();
  }
});

it('rejects a malformed revision and refuses overwriting a decided or partially created plan', async () => {
  const w = await planningWorkspace();
  try {
    const args = dialoguePlan();
    await w.engine.planning.prepare(w.live, args);
    await w.engine.planning.propose(w.live, { key: args.key });
    const before = w.engine.planning.store(w.live).get(args.key);
    expect(
      (
        await reviseChatPlan(w.engine, w.live, {
          ...args,
          title: 'bad',
          expectedTotal: 999,
          reason: 'Correction',
        })
      ).isError,
    ).toBe(true);
    expect(w.engine.planning.store(w.live).get(args.key)).toEqual(before);
    const item = w.engine.proposals.proposals(w.live).at(-1)!;
    new PlanJournal(w.engine, w.live).save({
      item: { ...item, state: 'accepted', result: { selected: ['selected-ref'] } },
    });
    expect(
      (await reviseChatPlan(w.engine, w.live, { ...args, title: 'changed', reason: 'Correction' }))
        .isError,
    ).toBe(true);
    expect(w.engine.planning.store(w.live).get(args.key)).toEqual(before);
  } finally {
    await w.close();
  }
});
