import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { c4Hash, git } from '@skaro/core';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { taskC4Protocol } from '../c4-protocol';
import { C4SemanticStore } from '../c4-semantic-store';
import { inspectSemanticC4Review } from '../c4-semantic-gate';
import { c4SemanticSnapshot } from '../c4-semantic-snapshot';
import { eventually } from './resource-workflow-observation';
import { coordinatorSourceAudit } from './coordinator-source-audit';
import { approveC4TaskCommands, C4_REFERENCE_COMMAND } from './c4-task-permissions';

/** Real authorized rename in the ordinary task workflow and a fresh native independent review. */
export async function renameC4CoordinationTask(s: Services, project: string, directory: string) {
  const context = s.projects.get(project),
    handlers = sessionHandlers(s),
    task = 'T-012';
  const artifacts = await context.store.load();
  assert.equal(artifacts.c4?.revision, 1);
  assert.equal(artifacts.c4.questions.length, 9);
  const source = await coordinatorSourceAudit(context.root);
  const css = await readFile(join(context.root, 'css/base.css'));
  const html = await readFile(join(context.root, 'index.html'), 'utf8');
  const previous = (await handlers['c4.coordination'](project)).protocol;
  const existing = s.db.latestRun(project, task);
  if (existing) {
    assert.equal(existing.agent, 'codex');
    assert.equal(taskC4Protocol(s.db, project, existing.id), 'impact-v1');
    assert(existing.worktree);
  }
  for (const old of s.db.listRuns(project))
    if (old.taskId !== task) assert.equal(taskC4Protocol(s.db, project, old.id), 'package-v1');
  await handlers['c4.selectProtocol'](project, 'impact-v1', previous);
  let success = false;
  try {
    const instruction =
      'Продолжи разрешённое техническое переименование и независимую проверку C4-2';
    const commandId = randomUUID();
    const prompt =
      (existing
        ? `Это явное продолжение после остановки драйвера. Сначала вызови resume_task с command_id="${commandId}" и instruction="${instruction}". ${instruction}. Если переименование и ссылка уже исправлены, сохрани их и НЕ повторяй git mv/замену. `
        : '') +
      'Владелец явно разрешил пакет C4 ревизии 1 (уже применён), техническое переименование и штатную сдачу T-012. Сейчас выполни ТОЛЬКО переименование и запрос независимого ревью. ' +
      'Прочитай get_c4_context. В своём worktree выполни отдельно точные команды (без цепочек, pipe и других команд): git mv -- css/base.css css/layout.css ; затем команду обновления одной ссылки: ' +
      C4_REFERENCE_COMMAND +
      ' Допустимые проверки: git status --short, git diff --check, git diff --stat, git diff --name-status, git diff --find-renames, node --check js/controls.js; чтение Get-Content -Raw -LiteralPath для index.html, css/base.css, css/layout.css, css/scene.css, css/cat.css, css/plane.css, js/controls.js. ' +
      'CSS побайтно сохранить, никаких иных исходников/функций/документов/критериев не менять. Не исправляй существующий controls.js TODO и открытые вопросы. planned/current не менять. ' +
      'После проверок вызови review_c4 с фактическими данными и realized:[]: impact-v1 игнорирует твоё самостоятельное aligned и запускает независимого проверяющего. Затем закончи ход без polling. ' +
      'НЕ вызывай submit_result, merge_task или commit до отдельного сообщения C42_SUBMISSION_AUTHORIZED от контроллера: до него критерий восстановления ещё проверяется. После автоматического продолжения также только сообщи C42_REVIEW_READY и закончи ход, не сдавая результат.';
    if (existing) s.commands.accept('task.send', project, task, { commandId, text: prompt });
    else await handlers['tasks.run'](project, [task], prompt);
    const store = new C4SemanticStore(s.db);
    let last = '';
    const job = await eventually(
      async () => {
        await approveC4TaskCommands(s, project, task);
        const run = s.db.latestRun(project, task);
        if (!run) return undefined;
        const current = store.current(run.id);
        const stage = current?.state ?? s.db.getTaskRuntime(project).get(task)?.state ?? 'starting';
        if (stage !== last) {
          last = stage;
          process.send?.({ stage: 't012-review-progress', state: stage, run: run.id });
        }
        if (current && ['failed', 'uncertain'].includes(current.state))
          throw new Error(current.error ?? current.state);
        return current;
      },
      (value) => value?.state === 'verified' && value.delivered === true,
      'T-012 real independent review',
      600000,
    );
    assert(job && job.verdict?.implementation === 'aligned' && job.verdict.category === 'aligned');
    const snapshot = await c4SemanticSnapshot(s.db, context, task, job.runId, false);
    assert(snapshot.preservation && snapshot.preservation.moves.length === 1);
    assert.deepEqual(
      snapshot.preservation.moves.map((m) => [m.from, m.to]),
      [['css/base.css', 'css/layout.css']],
    );
    const run = s.db.getRun(job.runId)!;
    assert.equal(taskC4Protocol(s.db, project, run.id), 'impact-v1');
    assert(run.worktree);
    assert.deepEqual(await readFile(join(run.worktree, 'css/layout.css')), css);
    assert.equal(
      await readFile(join(run.worktree, 'index.html'), 'utf8'),
      html.replace('css/base.css', 'css/layout.css'),
    );
    assert.deepEqual(snapshot.observation.scope.files, [
      'css/base.css',
      'css/layout.css',
      'index.html',
    ]);
    const review = await inspectSemanticC4Review(s.db, context, task, run.id);
    assert.deepEqual(review.realized, []);
    assert.equal(
      (await s.c4.records(project, task)).length,
      0,
      'Accepted technical implementation needs no new owner C4 card',
    );
    assert.deepEqual(await coordinatorSourceAudit(context.root), source);
    assert.deepEqual((await context.store.load()).c4, artifacts.c4);
    const diff = await git(run.worktree, [
      'diff',
      '--find-renames',
      'HEAD',
      '--',
      '.',
      ':(exclude).skaro',
    ]);
    await writeFile(join(directory, 't012.diff'), diff.stdout);
    await writeFile(
      join(directory, 'independent-review.json'),
      JSON.stringify({ job, review, snapshot }, null, 2),
    );
    success = true;
    return {
      run,
      job,
      review,
      source,
      cssHash: c4Hash(css.toString('base64')),
      pureMove: snapshot.preservation,
    };
  } finally {
    await handlers['task.interrupt'](project, task);
    await handlers['c4.selectProtocol'](project, previous, 'impact-v1');
    process.send?.({ stage: 't012-stopped-with-work-preserved', success });
  }
}
