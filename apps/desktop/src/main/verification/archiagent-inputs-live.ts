import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { taskC4Protocol } from '../c4-protocol';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { eventually } from './resource-workflow-observation';
import { taskInputSnapshot } from '../task-preflight-inputs';
import { RESOURCE_POLICY_KEY } from '../resource-policy';
import type { ResourceBudgetPolicy } from '../resource-budget';
import { coordinatorSourceAudit } from './coordinator-source-audit';

const title = 'Приёмка AG-1: актуальные входы и новый протокол Cat-pilot';
/** A genuine read-only acceptance task created through the ordinary store/run workflow, never a seeded run. */
export async function verifyArchiagentInputs(s: Services, project: string) {
  const context = s.projects.get(project),
    handlers = sessionHandlers(s);
  assert(
    !(await context.load()).tasks.some((task) => task.title === title),
    'Do not duplicate a real acceptance task',
  );
  const source = await coordinatorSourceAudit(context.root);
  const task = await context.store.createTask({
    title,
    agent: 'codex',
    body: '## Цель\n\nПроверить текущие входы настоящего Cat-pilot и совместимость нового запуска AG-1. Только чтение исходников и штатные проверки. Не реализовывать продуктовые задачи.\n\n## Критерии приёмки\n\n- [ ] Проверен синтаксис действующего js/pause-controls.js через node --check.\n- [ ] После ожидания лимита прочитана текущая версия требований этой задачи.\n- [ ] Продуктовые исходники и критерии прежних задач сохранены.\n- [ ] Новый запуск штатно закреплён за impact-v1, старые bindings не переписаны.\n',
  });
  context.invalidate();
  await handlers['task.setSettings'](project, task.id, {
    agent: 'codex',
    permissionMode: 'ask',
    planFirst: false,
    isolation: 'worktree',
  });
  const originalPolicy = s.db.getSetting<Partial<ResourceBudgetPolicy>>(RESOURCE_POLICY_KEY, {});
  let changedPolicy = false;
  const first = await s.runs.open(project, task.id),
    marker = `AG1_INPUT_${randomUUID().slice(0, 8)}`;
  try {
    s.commands.accept('task.send', project, task.id, {
      commandId: randomUUID(),
      text: `Ограниченная реальная read-only приёмка AG-1. Только прочитай read_project_memory с source="${task.path}" и закончи ответом ${marker}_FIRST. Не вызывай другие инструменты, не меняй и не читай файлы shell-командами, не меняй критерии, не реализуй продукт и не сдавай результат.`,
    });
    const ready = await eventually(
      () => s.runs.open(project, task.id),
      (v) =>
        v.timeline!.turns.length > (first.timeline?.turns.length ?? 0) &&
        !!v.timeline!.turns.at(-1)?.outcome &&
        v.timeline!.status === 'idle',
      'new real read-only impact run',
      240000,
    );
    assert.equal(ready.timeline!.turns.at(-1)?.outcome, 'done');
    assert(ready.run?.worktree);
    const run = s.db.latestRun(project, task.id)!;
    assert.equal(taskC4Protocol(s.db, project, run.id), 'impact-v1');
    const check = await promisify(execFile)(
      'node',
      ['--check', join(run.worktree!, 'js/pause-controls.js')],
      { windowsHide: true, timeout: 20000 },
    );
    assert.equal(check.stderr, '');
    const account = s.db.admission
      .all()
      .find(
        (row) => row.projectId === project && row.ownerId === `task:${task.id}` && row.account,
      )?.account;
    assert(
      account &&
        !originalPolicy.accounts?.[account]?.blocked &&
        (originalPolicy.accounts?.[account]?.slots ?? 1) > 0,
    );
    const oldInputs = await taskInputSnapshot(s.db, context, await context.load(), task.id);
    const turns = ready.timeline!.turns.length;
    s.db.setSetting(RESOURCE_POLICY_KEY, {
      ...originalPolicy,
      accounts: {
        ...originalPolicy.accounts,
        [account]: { slots: originalPolicy.accounts?.[account]?.slots ?? 1, blocked: true },
      },
    });
    changedPolicy = true;
    s.resources.manager.poke();
    const command = randomUUID();
    s.commands.accept('task.send', project, task.id, {
      commandId: command,
      text: `Продолжение read-only приёмки AG-1. Через read_project_memory с source="${task.path}" прочитай текущую строку «Контрольная версия требований», процитируй её точно и закончи. Версию не угадывай, она изменяется владельцем во время ожидания. Ничего не меняй, не вызывай другие инструменты, не запускай команды и не сдавай результат.`,
    });
    const waiting = await eventually(
      () =>
        s.db.admission
          .all()
          .find(
            (row) =>
              row.projectId === project &&
              row.ownerId === `task:${task.id}` &&
              row.state === 'waiting_quota',
          ),
      Boolean,
      'genuine task waits for configured account limit',
    );
    assert(waiting);
    assert.equal((await s.runs.open(project, task.id)).timeline!.turns.length, turns);
    await context.store.updateTask(task.id, {
      body: task.body + `\nКонтрольная версия требований: ${marker}_CURRENT\n`,
    });
    context.invalidate();
    const current = await taskInputSnapshot(s.db, context, await context.load(), task.id);
    assert.notEqual(current.version, oldInputs.version);
    s.db.setSetting(RESOURCE_POLICY_KEY, originalPolicy);
    changedPolicy = false;
    s.resources.manager.poke();
    const result = await eventually(
      () => s.runs.open(project, task.id),
      (v) =>
        v.timeline!.turns.length > turns &&
        !!v.timeline!.turns.at(-1)?.outcome &&
        v.timeline!.status === 'idle',
      'fresh real task reads requirements changed while waiting',
      240000,
    );
    assert.equal(result.timeline!.turns.at(-1)?.outcome, 'done');
    assert(
      result.timeline!.items.some(
        (item) =>
          item.kind === 'message' &&
          item.role === 'agent' &&
          item.turnId === result.timeline!.turns.at(-1)?.id &&
          item.text?.includes(`${marker}_CURRENT`),
      ),
    );
    assert.deepEqual(await coordinatorSourceAudit(context.root), source);
    return {
      task: task.id,
      run: run.id,
      protocol: taskC4Protocol(s.db, project, run.id),
      syntaxCheck: 'node --check js/pause-controls.js',
      waitingLease: waiting.id,
      previousInputs: oldInputs.version,
      currentInputs: current.version,
      marker,
      nativeReadCurrentVersion: true,
      sourcePreserved: true,
      dirtyUserWorkTested: false,
    };
  } finally {
    await handlers['task.interrupt'](project, task.id);
    if (changedPolicy) {
      s.db.setSetting(RESOURCE_POLICY_KEY, originalPolicy);
      s.resources.manager.poke();
    }
  }
}
