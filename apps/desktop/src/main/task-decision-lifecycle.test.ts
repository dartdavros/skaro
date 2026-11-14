import { expect, it, vi } from 'vitest';
import { db, projects, projectId, taskId, runId, restartTaskEngine } from './task-run-test-support';
import { TaskExecution } from './task-execution';
import { projectDecisionProjection } from './decision-projection';
import { taskDecisionSources } from './task-decision-sources';
vi.setConfig({ hookTimeout: 60000, testTimeout: 60000 });

it('keeps closed and archived task counts at zero through history restore, old follow-up and controller requests, while retaining active questions', async () => {
  let engine = await restartTaskEngine();
  const active = (await engine.history.restore(projectId, taskId))!;
  for (const id of ['old-native', 'coordinator:old-controller'])
    engine.history.skaroEvent(active, {
      t: 'interaction.opened',
      interaction: {
        id,
        kind: 'question',
        delivery: 'async',
        questions: [
          {
            id: 'q',
            text: 'Исторический вопрос',
            header: '',
            multi: false,
            allowFreeText: true,
            options: [],
          },
        ],
      },
    });
  new TaskExecution(db, runId).followUp('old-command', 'Старое обсуждение результата');
  await new Promise<void>((resolve, reject) =>
    active.log!.write('', (error) => (error ? reject(error) : resolve())),
  );
  const decisions = async () =>
    projectDecisionProjection(await taskDecisionSources(engine, projectId));
  expect(
    (await decisions()).map((row) => row.kind === 'interaction' && row.interaction.id),
  ).toEqual(['old-native', 'coordinator:old-controller']);
  for (const patch of [
    { status: 'done' as const, archived: false },
    { status: 'cancelled' as const, archived: false },
    { status: 'todo' as const, archived: true },
    { status: 'in_progress' as const, archived: true },
  ]) {
    await projects.get(projectId).store.updateTask(taskId, patch);
    projects.get(projectId).invalidate();
    expect(await decisions()).toEqual([]);
    engine = await restartTaskEngine();
    expect(new TaskExecution(db, runId).read().followUp).toBeDefined();
    expect(await decisions()).toEqual([]);
  }
});
