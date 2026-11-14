import { expect, it } from 'vitest';
import { parseTaskReplan, deleteTasksTool } from '@skaro/mcp-server';
import { replanWorkspace } from './task-replan-test-workspace';
import { TaskReplanJournal } from './task-replan-journal';
import { taskFiles } from './task-replan-files';
import { prepareTaskReplan } from './task-replan-prepare';

it('exposes deletion only in project chat and applies incoming edge removal once after owner acceptance, then reverts exact originals', async () => {
  const w = await replanWorkspace();
  try {
    const before = (await w.store.load()).tasks;
    const files = await taskFiles(w.store.root, before);
    const scope = {
      kind: 'project_chat' as const,
      projectId: w.live.projectId,
      chatId: w.live.chat.id,
    };
    const tool = deleteTasksTool((args, bound) => {
      expect(bound).toEqual(scope);
      return w.engine.replans.propose(w.live, args);
    });
    const raw = { key: 'delete', title: 'Удалить лишнюю задачу', task_ids: [w.b.id] };
    expect(
      (await tool.call(raw, { ...scope, kind: 'task', taskId: w.a.id, runId: 'r' })).isError,
    ).toBe(true);
    expect((await tool.call(raw, { ...scope, importId: 'i' })).isError).toBe(true);
    expect((await tool.call(raw, scope)).isError).not.toBe(true);
    expect((await w.store.load()).tasks).toEqual(before);
    const item = w.engine.proposals.proposals(w.live).at(-1)!;
    expect(item.proposal).toMatchObject({
      taskIds: [w.b.id],
      tasks: [],
      rewired: [{ id: w.c.id, dependsOn: [] }],
    });
    await w.apply(item);
    await w.apply(item);
    const after = (await w.store.load()).tasks;
    expect(after.map((t) => t.id)).toEqual([w.a.id, w.c.id]);
    expect(after.find((t) => t.id === w.c.id)!.dependsOn).toEqual([]);
    expect(
      new TaskReplanJournal(w.db, w.live.projectId).list()[0]!.removes.map((t) => t.id),
    ).toEqual([w.b.id]);
    await w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, item.id, {
      action: 'revert',
    });
    expect((await w.store.load()).tasks).toEqual(before);
    expect(await taskFiles(w.store.root, before)).toEqual(files);
  } finally {
    await w.close();
  }
});

it('supports deleting the whole selected graph with zero replacements and rejects ambiguous or stale deletion', async () => {
  const w = await replanWorkspace();
  try {
    const ids = [w.a.id, w.b.id, w.c.id];
    const args = parseTaskReplan({
      key: 'delete-all',
      title: 'Удалить выбранный план',
      task_ids: ids,
      delete_ids: ids,
      tasks: [],
    });
    expect(() =>
      parseTaskReplan({
        key: 'bad',
        title: 'bad',
        task_ids: ids,
        delete_ids: ['T-999'],
        tasks: [],
      }),
    ).toThrow('distinct source');
    const artifacts = await w.store.load();
    expect(() => prepareTaskReplan({ ...w.args, deleteIds: [w.a.id] }, artifacts, 'ru')).toThrow(
      'deleted tasks',
    );
    const item = await w.offer(args);
    await w.store.updateTask(w.b.id, { title: 'Изменённая задача' });
    const before = (await w.store.load()).tasks;
    await expect(w.apply(item)).rejects.toThrow('changed after');
    expect((await w.store.load()).tasks).toEqual(before);
    await w.apply(await w.offer({ ...args, key: 'delete-all-fresh' }));
    expect((await w.store.load()).tasks).toEqual([]);
  } finally {
    await w.close();
  }
});

it('requires explicit revision intent to change requirements and dependency lists in a reviewed plan', async () => {
  const w = await replanWorkspace();
  try {
    const args = {
      key: 'revise',
      title: 'Исправить план',
      taskIds: [w.b.id],
      tasks: [
        {
          ...w.args.tasks[0]!,
          id: w.b.id,
          sources: [w.b.id],
          goal: 'Исправленная цель',
          criteria: ['Новый согласованный критерий'],
          dependsOn: [],
        },
      ],
    };
    await expect(w.offer(args)).rejects.toThrow('criteria must be preserved');
    const item = await w.offer({
      ...args,
      revisionReason: 'Владелец отменил прежний критерий и зависимость.',
    });
    expect((await w.store.readTask(w.b.id)).dependsOn).toEqual([w.a.id]);
    await w.apply(item);
    expect(await w.store.readTask(w.b.id)).toMatchObject({ dependsOn: [] });
    expect((await w.store.readTask(w.b.id)).body).toContain('Новый согласованный критерий');
  } finally {
    await w.close();
  }
});

it('refuses deletion of started work or a protected dependent before proposing any mutations', async () => {
  const w = await replanWorkspace();
  try {
    await w.store.updateTask(w.c.id, { archived: true });
    await expect(
      w.offer({
        key: 'protected',
        title: 'Удалить',
        taskIds: [w.b.id],
        deleteIds: [w.b.id],
        tasks: [],
      }),
    ).rejects.toThrow('never started');
    expect((await w.store.load()).tasks).toHaveLength(3);
    expect(w.engine.proposals.proposals(w.live)).toHaveLength(0);
  } finally {
    await w.close();
  }
});
