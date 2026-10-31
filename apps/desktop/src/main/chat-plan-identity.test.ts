import { expect, it } from 'vitest';
import { AppDb, type Task } from '@skaro/core';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import { ChatEngine } from './chat-engine';
import { PlanJournal } from './chat-plan-journal';
import { dialoguePlan, planningWorkspace } from './chat-planning-test-workspace';
import { LiveChat } from './chat-model';
import { Timeline } from '@skaro/timeline';

it('migrates 28 applied plain refs into a 75-task saved plan and creates only 47 after one approval', async () => {
  const w = await planningWorkspace();
  try {
    const args = dialoguePlan();
    const originals: Task[] = [];
    for (const group of args.milestones) {
      const batch = group.tasks.slice(0, Math.min(3, 28 - originals.length));
      if (!batch.length) break;
      const tasks = batch.map((t) => w.engine.plan.proposedTask(t, new Map()));
      w.engine.proposals.addProposal(
        w.live,
        {
          type: 'plan',
          milestone: { id: group.milestone, title: group.milestone, isNew: false },
          tasks,
        },
        'applied',
      );
      const card = w.engine.proposals.proposals(w.live).at(-1)!;
      const created = [];
      for (const task of tasks) {
        const t = await w.store.createTask({
          title: task.title,
          milestone: group.milestone,
          spec: task.spec,
          body: 'Original description and completed work',
          dependsOn: task.dependsOn.map(() => originals[0]!.id),
        });
        await w.store.updateTask(t.id, { status: 'done' });
        originals.push(t);
        created.push({ id: t.id, title: t.title, ref: task.ref });
      }
      new PlanJournal(w.engine, w.live).save({ item: { ...card, result: { tasks: created } } });
    }
    expect(originals).toHaveLength(28);
    await w.engine.planning.prepare(w.live, args);
    await w.engine.planning.propose(w.live, { key: args.key });
    const review = w.engine.proposals.proposals(w.live).find((p) => p.state === 'pending')!;
    expect(review.result?.tasks).toHaveLength(28);
    expect(review.result?.tasks?.every((t) => t.ref.startsWith('plan:dialogue:'))).toBe(true);
    await w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, review.id, {
      action: 'apply',
    });
    const tasks = (await w.store.load()).tasks;
    expect(tasks).toHaveLength(75);
    expect(new Set(tasks.map((t) => t.title)).size).toBe(75);
    expect(tasks.filter((t) => t.status === 'done')).toHaveLength(28);
    expect(tasks.filter((t) => t.body.includes('Original description'))).toHaveLength(28);
    expect(
      tasks.filter((t) => t.dependsOn.length).every((t) => t.dependsOn[0] === originals[0]!.id),
    ).toBe(true);
    w.engine.history.flush(w.live);
    w.live.log!.end();
    await finished(w.live.log!);
    w.live.log = undefined;
    const db = AppDb.open(join(w.root, 'skaro.db'));
    const reopened = new ChatEngine({ ...w.engine.deps, db });
    try {
      await reopened.views.open(w.live.projectId, w.live.chat.id);
      await reopened.planning.propose(reopened.live.get(w.live.chat.id)!, { key: args.key });
      expect((await w.store.load()).tasks).toHaveLength(75);
    } finally {
      const live = reopened.live.get(w.live.chat.id)!;
      reopened.planningContinuation.userMessage(live);
      await reopened.planningContinuation.settled(live);
      reopened.history.flush(live);
      live.log?.end();
      if (live.log) await finished(live.log);
      db.close();
    }
  } finally {
    await w.close();
  }
}, 30_000);

it('rejects an unproven existing-task collision before creating even independent tasks', async () => {
  const w = await planningWorkspace();
  try {
    await w.engine.planning.prepare(w.live, dialoguePlan());
    await w.engine.planning.propose(w.live, { key: 'dialogue' });
    const card = w.engine.proposals.proposals(w.live)[0]!;
    const target = dialoguePlan().milestones[1]!.tasks[0]!;
    const existing = await w.store.createTask({
      title: target.title,
      spec: '0001',
      milestone: 'M09',
    });
    await expect(
      w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, card.id, { action: 'apply' }),
    ).rejects.toThrow('already exists');
    expect((await w.store.load()).tasks.map((t) => t.id)).toEqual([existing.id]);
    expect(new PlanJournal(w.engine, w.live).list()[0]!.item.state).toBe('pending');
  } finally {
    await w.close();
  }
});

it('does not trust a historical result whose task number now belongs to a different task', async () => {
  const w = await planningWorkspace();
  try {
    const args = dialoguePlan();
    const task = w.engine.plan.proposedTask(args.milestones[0]!.tasks[0]!, new Map());
    w.engine.proposals.addProposal(
      w.live,
      { type: 'plan', milestone: { id: 'M08', title: 'M08', isNew: false }, tasks: [task] },
      'applied',
    );
    const wrong = await w.store.createTask({
      title: 'An unrelated historical task',
      milestone: 'M08',
      spec: '0001',
    });
    new PlanJournal(w.engine, w.live).save({
      item: {
        ...w.engine.proposals.proposals(w.live)[0]!,
        result: { tasks: [{ id: wrong.id, title: task.title, ref: task.ref }] },
      },
    });
    await w.engine.planning.prepare(w.live, args);
    await w.engine.planning.propose(w.live, { key: args.key });
    const review = w.engine.proposals.proposals(w.live).find((p) => p.state === 'pending')!;
    expect(review.result?.tasks).toEqual([]);
    expect((await w.store.load()).tasks).toHaveLength(1);
  } finally {
    await w.close();
  }
});

it('serializes creation across two chats so simultaneous approvals cannot create the same task twice', async () => {
  const w = await planningWorkspace();
  try {
    const other = new LiveChat(
      w.live.projectId,
      w.db.createChat({
        projectId: w.live.projectId,
        agent: 'codex',
        title: 'Second approval',
        logPath: 'second.jsonl',
      }),
      new Timeline(),
    );
    w.engine.live.set(other.chat.id, other);
    const task = w.engine.plan.proposedTask(dialoguePlan().milestones[0]!.tasks[0]!, new Map());
    for (const live of [w.live, other]) {
      w.engine.proposals.addProposal(
        live,
        { type: 'plan', complete: true, tasks: [task] },
        'pending',
      );
      await w.engine.planDecisions.accept(live, w.engine.proposals.proposals(live)[0]!);
    }
    await Promise.all([w.engine.planDecisions.drain(w.live), w.engine.planDecisions.drain(other)]);
    expect((await w.store.load()).tasks).toHaveLength(1);
    expect(w.engine.proposals.proposals(other)[0]!.result?.error).toContain('already exists');
    w.engine.history.flush(other);
    other.log?.end();
    if (other.log) await finished(other.log);
  } finally {
    await w.close();
  }
});
