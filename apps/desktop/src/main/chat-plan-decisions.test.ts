import { AppDb } from '@skaro/core';
import type { ProposedTask } from '@skaro/timeline';
import { expect, it } from 'vitest';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import { ChatEngine } from './chat-engine';
import { PlanJournal } from './chat-plan-journal';
import { dialoguePlan, openRecoveredChat, planningWorkspace } from './chat-planning-test-workspace';

function task(ref: string, dependsOn: string[] = []): ProposedTask {
  return {
    ref,
    title: ref,
    dependsOn,
    dependsOnTitles: dependsOn,
    body: `## Цель\n\n${ref}`,
    spec: '0001',
  };
}

it('creates all 75 tasks including M17 and M19 with one confirmation', async () => {
  const w = await planningWorkspace();
  try {
    await w.engine.planning.prepare(w.live, dialoguePlan());
    await w.engine.planning.propose(w.live, { key: 'dialogue' });
    await w.engine.planning.finish(w.live, { key: 'dialogue' });
    expect(w.engine.proposals.proposals(w.live)).toHaveLength(1);
    for (const card of w.engine.proposals.proposals(w.live)) {
      await w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, card.id, {
        action: 'apply',
      });
    }
    const tasks = (await w.store.load()).tasks;
    expect(tasks).toHaveLength(75);
    expect(tasks.filter((t) => t.milestone === 'M17')).toHaveLength(6);
    expect(tasks.filter((t) => t.milestone === 'M19')).toHaveLength(6);
    expect(tasks.filter((t) => t.dependsOn.length)).toHaveLength(11);
    expect(w.engine.proposals.proposals(w.live).every((i) => i.state === 'applied')).toBe(true);
    await openRecoveredChat(w.engine, w.live);
    expect((await w.store.load()).tasks).toHaveLength(75);
  } finally {
    await w.close();
  }
}, 30_000);

it('rejects an incomplete selection before writing any tasks and accepts a valid subset once', async () => {
  const w = await planningWorkspace();
  try {
    w.engine.proposals.addProposal(
      w.live,
      {
        type: 'plan',
        complete: true,
        tasks: [task('independent'), task('required'), task('dependent', ['required'])],
      },
      'pending',
    );
    const card = w.engine.proposals.proposals(w.live)[0]!;
    await expect(
      w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, card.id, {
        action: 'apply',
        tasks: ['independent', 'dependent'],
      }),
    ).rejects.toThrow('selected plan must include');
    expect((await w.store.load()).tasks).toHaveLength(0);
    await w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, card.id, {
      action: 'apply',
      tasks: ['independent'],
    });
    await openRecoveredChat(w.engine, w.live);
    expect((await w.store.load()).tasks.map((t) => t.title)).toEqual(['independent']);
    expect(w.engine.proposals.proposals(w.live)[0]!.state).toBe('applied');
  } finally {
    await w.close();
  }
});
it('recovers a saved approval and an already-written task with independent SQLite and log replay', async () => {
  const w = await planningWorkspace();
  try {
    w.engine.proposals.addProposal(
      w.live,
      {
        type: 'plan',
        complete: true,
        milestone: { id: 'M20', title: 'New', isNew: true },
        tasks: [task('first'), task('later', ['first'])],
      },
      'pending',
    );
    const card = w.engine.proposals.proposals(w.live)[0]!;
    await w.engine.planDecisions.accept(w.live, card);
    const journal = new PlanJournal(w.engine, w.live);
    const record = journal.list()[0]!;
    record.milestoneId = await w.store.reserveMilestoneId();
    journal.save(record);
    // Real intermediate state: milestone exists, result does not yet record it.
    await w.store.createReservedMilestone(record.milestoneId, { title: 'New' });
    record.creating = {
      ref: 'first',
      id: await w.store.reserveTaskId(),
      input: { title: 'first', milestone: record.milestoneId, dependsOn: [], spec: '0001' },
    };
    journal.save(record);
    await w.store.createReservedTask(record.creating.id, record.creating.input);
    w.engine.history.flush(w.live);
    w.live.log!.end();
    await finished(w.live.log!);
    w.live.log = undefined;
    const db = AppDb.open(join(w.root, 'skaro.db'));
    const recovered = new ChatEngine({ ...w.engine.deps, db });
    try {
      const opened = await openRecoveredChat(recovered, w.live);
      expect(opened.timeline.items.find((i) => i.id === card.id)).toMatchObject({
        state: 'applied',
      });
      const artifacts = await w.store.load();
      expect(artifacts.milestones).toHaveLength(20);
      expect(artifacts.tasks.map((t) => [t.title, t.dependsOn])).toEqual([
        ['first', []],
        ['later', ['T-001']],
      ]);
      await openRecoveredChat(recovered, w.live);
      expect((await w.store.load()).tasks).toHaveLength(2);
    } finally {
      const live = recovered.live.get(w.live.chat.id)!;
      recovered.history.flush(live);
      live.log?.end();
      if (live.log) await finished(live.log);
      db.close();
    }
  } finally {
    await w.close();
  }
});

it('reports cycles without creating dependent tasks or retrying forever', async () => {
  const w = await planningWorkspace();
  try {
    w.engine.proposals.addProposal(
      w.live,
      { type: 'plan', complete: true, tasks: [task('a', ['b']), task('b', ['a'])] },
      'pending',
    );
    const card = w.engine.proposals.proposals(w.live)[0]!;
    await expect(
      w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, card.id, { action: 'apply' }),
    ).rejects.toThrow('cycle');
    expect((await w.store.load()).tasks).toHaveLength(0);
  } finally {
    await w.close();
  }
});

it.each([false, true])(
  'cancels an interrupted creation and preserves only files already written (written=%s)',
  async (written) => {
    const w = await planningWorkspace();
    try {
      w.engine.proposals.addProposal(
        w.live,
        { type: 'plan', complete: true, tasks: [task('first'), task('later', ['first'])] },
        'pending',
      );
      await w.engine.planDecisions.accept(w.live, w.engine.proposals.proposals(w.live)[0]!);
      const journal = new PlanJournal(w.engine, w.live);
      const record = journal.list()[0]!;
      record.creating = {
        ref: 'first',
        id: await w.store.reserveTaskId(),
        input: { title: 'first' },
      };
      journal.save(record);
      if (written) await w.store.createReservedTask(record.creating.id, record.creating.input);
      await w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, record.item.id, {
        action: 'reject',
      });
      await openRecoveredChat(w.engine, w.live);
      expect((await w.store.load()).tasks).toHaveLength(written ? 1 : 0);
      const result = w.engine.proposals.proposals(w.live)[0]!;
      expect(result.state).toBe('rejected');
      expect(result.result?.tasks).toHaveLength(written ? 1 : 0);
      expect(journal.list()[0]!.creating).toBeUndefined();
    } finally {
      await w.close();
    }
  },
);
