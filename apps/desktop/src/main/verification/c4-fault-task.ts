import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { C4SemanticStore } from '../c4-semantic-store';
import { c4SemanticSnapshot } from '../c4-semantic-snapshot';
import { inspectSemanticC4Review } from '../c4-semantic-gate';
import { taskC4Protocol } from '../c4-protocol';
import { eventually } from './resource-workflow-observation';
import { coordinatorSourceAudit } from './coordinator-source-audit';
import { C4_SCRIPT_COMMAND, approveC4TaskCommands } from './c4-task-permissions';
import { verifyC4CoordinationBrowser } from './c4-coordination-browser';

export const C4_FAULT_TITLE = 'Приёмка C4-2: аварийное восстановление публикации Cat-pilot';

/** Owner approved this additional real rename and controlled publication crash explicitly. */
export async function prepareC4FaultTask(s: Services, project: string, directory: string) {
  const context = s.projects.get(project),
    handlers = sessionHandlers(s);
  const artifacts = await context.store.load();
  assert.equal(artifacts.c4?.revision, 2);
  const source = await coordinatorSourceAudit(context.root);
  const script = await readFile(join(context.root, 'js/controls.js'));
  const html = await readFile(join(context.root, 'index.html'), 'utf8');
  const task =
    artifacts.tasks.find((t) => t.title === C4_FAULT_TITLE) ??
    (await context.store.createTask({
      title: C4_FAULT_TITLE,
      agent: 'codex',
      body: '## Цель\n\nПодготовить настоящий ограниченный результат для аварийной приёмки C4-2. Владелец разрешил js/controls.js → js/pause-controls.js и замену одной ссылки в index.html, без изменения байтов JS, поведения, CSS, planned/current и 9 открытых вопросов. Контроллер отдельно выполняет аварийный выход во время настоящей публикации и штатное восстановление. Статус задачи сам по себе не доказывает crash/recovery. Не реализовать T-008 или другие продуктовые задачи.\n\n## Критерии приёмки\n\n- [ ] Выполнен только разрешённый Git rename JS и обновлена одна ссылка, содержимое и поведение сохранены.\n- [ ] Исходники проверены синтаксически, а независимое C4-ревью подтверждает принятое решение без новой карточки согласования.\n- [ ] Контроллеру передан точный проверенный результат для штатной сдачи и аварийной проверки, без обхода политик и подмены окружения.\n',
    }));
  context.invalidate();
  await handlers['task.setSettings'](project, task.id, {
    agent: 'codex',
    permissionMode: 'ask',
    planFirst: false,
    isolation: 'worktree',
  });
  const beforeProtocols = new Map(
    s.db.listRuns(project).map((r) => [r.id, taskC4Protocol(s.db, project, r.id)]),
  );
  const previous = (await handlers['c4.coordination'](project)).protocol;
  await handlers['c4.selectProtocol'](project, 'impact-v1', previous);
  try {
    const existing = s.db.latestRun(project, task.id),
      commandId = randomUUID();
    const instruction = 'Продолжи разрешённую подготовку аварийной проверки C4-2';
    const prompt =
      (existing
        ? `Это явное продолжение: сначала resume_task с command_id="${commandId}" и instruction="${instruction}". ${instruction}. Уже выполненные rename и замену не повторяй. `
        : '') +
      `Владелец разрешил только техническое переименование js/controls.js → js/pause-controls.js и одну ссылку. CSS уже переименован в layout.css в T-012, его не менять. JS содержит только два существующих комментария о будущей T-008, никаких обработчиков не добавлять. ` +
      `Сначала get_c4_context, затем четыре отдельные точные shell-команды без цепочек и pipe: git mv -- js/controls.js js/pause-controls.js ; ${C4_SCRIPT_COMMAND} ; git diff --find-renames HEAD ; node --check js/pause-controls.js . ` +
      'Если нужно чтение, только Get-Content -Raw -LiteralPath index.html / js/controls.js / js/pause-controls.js. Не менять другие файлы, критерии, модель, документацию, задачи и статусы. ' +
      'Вызови review_c4 с фактическими данными и realized:[], затем закончи ход. Никакого polling. До отдельного C42_FAULT_SUBMISSION_AUTHORIZED от контроллера НЕ вызывай submit_result/merge_task, не делай commit. Автоматическое продолжение после независимого ревью также только C42_FAULT_REVIEW_READY и конец хода.';
    if (existing) s.commands.accept('task.send', project, task.id, { commandId, text: prompt });
    else await handlers['tasks.run'](project, [task.id], prompt);
    const store = new C4SemanticStore(s.db);
    const job = await eventually(
      async () => {
        await approveC4TaskCommands(s, project, task.id, 'js');
        const run = s.db.latestRun(project, task.id);
        const current = run ? store.current(run.id) : undefined;
        if (current && ['failed', 'uncertain'].includes(current.state))
          throw new Error(current.error ?? current.state);
        return current;
      },
      (j) => j?.state === 'verified' && j.delivered === true,
      'real JS move independent review',
      600000,
    );
    assert(job?.verdict?.implementation === 'aligned' && job.verdict.category === 'aligned');
    const run = s.db.getRun(job.runId)!;
    assert(run.worktree);
    assert.deepEqual(await readFile(join(run.worktree, 'js/pause-controls.js')), script);
    assert.equal(
      await readFile(join(run.worktree, 'index.html'), 'utf8'),
      html.replace('js/controls.js', 'js/pause-controls.js'),
    );
    const snapshot = await c4SemanticSnapshot(s.db, context, task.id, run.id, false);
    assert.deepEqual(
      snapshot.preservation?.moves.map((m) => [m.from, m.to]),
      [['js/controls.js', 'js/pause-controls.js']],
    );
    assert.deepEqual(snapshot.observation.scope.files, [
      'index.html',
      'js/controls.js',
      'js/pause-controls.js',
    ]);
    const review = await inspectSemanticC4Review(s.db, context, task.id, run.id);
    assert.deepEqual(review.realized, []);
    assert.equal((await s.c4.records(project, task.id)).length, 0);
    const browser = await verifyC4CoordinationBrowser(s, project, directory, task.id);
    assert.deepEqual(await coordinatorSourceAudit(context.root), source);
    for (const [id, protocol] of beforeProtocols)
      assert.equal(taskC4Protocol(s.db, project, id), protocol);
    const proof = {
      taskId: task.id,
      run,
      job,
      review,
      browser,
      source,
      originalModel: artifacts.c4,
    };
    await writeFile(join(directory, 'fault-task-review.json'), JSON.stringify(proof, null, 2));
    return proof;
  } finally {
    await handlers['task.interrupt'](project, task.id);
    await handlers['c4.selectProtocol'](project, previous, 'impact-v1');
  }
}
