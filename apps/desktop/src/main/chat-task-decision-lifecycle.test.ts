import { expect, it } from 'vitest';
import { planningWorkspace } from './chat-planning-test-workspace';
import { chatDecisionSources } from './chat-decision-sources';
import { projectDecisionProjection } from './decision-projection';
import { stageSubject } from './task-subject';
import { terminalTaskHistory } from './terminal-task-requests';
it('excludes chat proposals targeting closed, archived or removed tasks without hiding a current question', async () => {
  const w = await planningWorkspace();
  try {
    const task = await w.store.createTask({ title: 'Текущая задача' });
    const context = w.engine.project(w.live.projectId);
    context.invalidate();
    w.engine.proposals.addProposal(
      w.live,
      {
        type: 'task',
        id: task.id,
        title: task.title,
        before: 'old',
        after: 'new',
        patch: { title: 'new' },
      },
      'pending',
    );
    const decisions = async () =>
      projectDecisionProjection(await chatDecisionSources(w.engine, w.live.projectId));
    expect(await decisions()).toHaveLength(1);
    for (const patch of [
      { status: 'done' as const, archived: false },
      { status: 'cancelled' as const, archived: false },
      { status: 'todo' as const, archived: true },
    ]) {
      await w.store.updateTask(task.id, patch);
      context.invalidate();
      expect(await decisions()).toEqual([]);
    }
    w.live.timeline.apply({
      t: 'interaction.opened',
      interaction: { kind: 'question', id: 'async-current', delivery: 'async', questions: [] },
    });
    expect(await decisions()).toHaveLength(1);
    await w.store.deleteTask(task.id);
    context.invalidate();
    expect(await decisions()).toHaveLength(1);
  } finally {
    await w.close();
  }
});
it('retires milestone acceptance when every member is archived without falsely declaring incomplete work done', async () => {
  const w = await planningWorkspace();
  try {
    const task = await w.store.createTask({ title: 'Архивная задача', milestone: 'M02' });
    await w.store.updateTask(task.id, { archived: true });
    const artifacts = await w.store.load();
    const subject = stageSubject(
      artifacts.milestones.find((m) => m.id === 'M02')!,
      artifacts,
    );
    expect(subject.archived).toBe(true);
    expect(subject.status).toBe('todo');
    expect(terminalTaskHistory(w.db, subject.status, undefined, subject.archived)).toBe(true);
    expect(
      stageSubject(
        artifacts.milestones.find((m) => m.id === 'M03')!,
        artifacts,
      ).archived,
    ).toBe(false);
  } finally {
    await w.close();
  }
});
