import { expect, it } from 'vitest';
import { feedRows, type ProposedTask } from '@skaro/timeline';
import { PlanJournal } from './chat-plan-journal';
import { dialoguePlan, openRecoveredChat, planningWorkspace } from './chat-planning-test-workspace';

const task = (ref: string, deps: string[] = []): ProposedTask => ({
  ref,
  title: ref,
  dependsOn: deps,
  dependsOnTitles: deps,
  body: ref,
});

it('combines legacy interleaved milestone cards into one confirmation, preserving unrelated work', async () => {
  const w = await planningWorkspace();
  try {
    for (const [id, tasks] of [
      ['M08', [task('a'), task('c', ['b'])]],
      ['M09', [task('b', ['a'])]],
    ] as const) {
      w.engine.proposals.addProposal(
        w.live,
        { type: 'plan', milestone: { id, title: id, isNew: false }, tasks: [...tasks] },
        'pending',
      );
    }
    w.engine.proposals.addProposal(w.live, { type: 'plan', tasks: [task('unrelated')] }, 'pending');
    await openRecoveredChat(w.engine, w.live);
    const cards = w.engine.proposals.proposals(w.live);
    expect(cards).toHaveLength(2);
    const plan = cards[0]!;
    expect(plan.proposal).toMatchObject({ complete: true });
    expect(feedRows(w.live.timeline.state).filter((r) => r.type === 'proposal')).toHaveLength(2);
    await w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, plan.id, {
      action: 'apply',
    });
    const tasks = (await w.store.load()).tasks;
    expect(tasks.map((t) => [t.title, t.milestone, t.dependsOn])).toEqual([
      ['a', 'M08', []],
      ['b', 'M09', ['T-001']],
      ['c', 'M08', ['T-002']],
    ]);
    expect(w.engine.proposals.proposals(w.live)[1]!.state).toBe('pending');
  } finally {
    await w.close();
  }
});

it('consolidates a partially accepted legacy plan and preserves created tasks and explicit refusals', async () => {
  const w = await planningWorkspace();
  try {
    w.engine.proposals.addProposal(
      w.live,
      { type: 'plan', tasks: [task('done'), task('draft', ['privacy']), task('declined')] },
      'pending',
    );
    w.engine.proposals.addProposal(w.live, { type: 'plan', tasks: [task('privacy')] }, 'pending');
    const cards = w.engine.proposals.proposals(w.live);
    const done = await w.store.createTask({ title: 'done' });
    new PlanJournal(w.engine, w.live).save({
      item: {
        ...cards[0]!,
        state: 'accepted',
        result: {
          selected: ['done', 'draft'],
          tasks: [{ id: done.id, title: done.title, ref: 'done' }],
          waiting: [{ ref: 'draft', reason: 'legacy waiting' }],
        },
      },
    });
    await openRecoveredChat(w.engine, w.live);
    const plan = w.engine.proposals.proposals(w.live)[0]!;
    expect(w.engine.proposals.proposals(w.live)).toHaveLength(1);
    expect(plan.state).toBe('pending');
    expect(plan.result?.omitted).toEqual(['declined']);
    expect((await w.store.load()).tasks).toHaveLength(1);
    const twice = await Promise.allSettled(
      [1, 2].map(() =>
        w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, plan.id, { action: 'apply' }),
      ),
    );
    expect(twice.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((await w.store.load()).tasks.map((t) => [t.title, t.dependsOn])).toEqual([
      ['done', []],
      ['privacy', []],
      ['draft', ['T-002']],
    ]);
    await openRecoveredChat(w.engine, w.live);
    expect((await w.store.load()).tasks).toHaveLength(3);
  } finally {
    await w.close();
  }
});

it('restores the full saved plan when only the first milestone had been proposed previously', async () => {
  const w = await planningWorkspace();
  try {
    await w.engine.planning.prepare(w.live, dialoguePlan());
    const plan = w.engine.planning.store(w.live).get('dialogue')!;
    const tasks = w.engine.planReview.tasks(plan, await w.store.load());
    w.engine.proposals.addProposal(
      w.live,
      { type: 'plan', planKey: plan.key, tasks: tasks.slice(0, 8) },
      'pending',
    );
    await openRecoveredChat(w.engine, w.live);
    const cards = w.engine.proposals.proposals(w.live);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.proposal.type === 'plan' && cards[0]!.proposal.tasks.length).toBe(75);
    expect((await w.store.load()).tasks).toHaveLength(0);
  } finally {
    await w.close();
  }
});

it('recovers the rest of a saved plan when every card in the first batch was already applied', async () => {
  const w = await planningWorkspace();
  try {
    await w.engine.planning.prepare(w.live, dialoguePlan());
    const plan = w.engine.planning.store(w.live).get('dialogue')!;
    const tasks = w.engine.planReview.tasks(plan, await w.store.load());
    w.engine.proposals.addProposal(
      w.live,
      { type: 'plan', planKey: plan.key, tasks: tasks.slice(0, 8) },
      'applied',
    );
    const old = w.engine.proposals.proposals(w.live)[0]!;
    const created = [];
    for (const task of tasks.slice(0, 8)) {
      const t = await w.store.createTask({ title: task.title, milestone: 'M08' });
      created.push({ id: t.id, title: t.title, ref: task.ref });
    }
    new PlanJournal(w.engine, w.live).save({ item: { ...old, result: { tasks: created } } });
    await openRecoveredChat(w.engine, w.live);
    const review = w.engine.proposals.proposals(w.live)[0]!;
    expect(review.state).toBe('pending');
    expect(review.result?.tasks).toHaveLength(8);
    expect(review.proposal.type === 'plan' && review.proposal.tasks.length).toBe(75);
    expect((await w.store.load()).tasks).toHaveLength(8);
  } finally {
    await w.close();
  }
});
