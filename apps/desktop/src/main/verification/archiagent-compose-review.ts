import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { git } from '@skaro/core';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { C4SemanticStore } from '../c4-semantic-store';
import { inspectSemanticC4Review } from '../c4-semantic-gate';
import { eventually } from './resource-workflow-observation';
import { verifyC4CoordinationBrowser } from './c4-coordination-browser';
import { prepareArchiagentCompose, AG1_COMPOSE_SHA } from './archiagent-compose-scope';

/** A fresh native independent review consumes the actual four-path result, not its old receipt. */
export async function reviewArchiagentCompose(s: Services, project: string, directory: string) {
  const prepared = await prepareArchiagentCompose(s, project, directory),
    { task, run, committed, base } = prepared,
    context = s.projects.get(project),
    handlers = sessionHandlers(s);
  try {
    const changed = (
      await git(run.worktree!, ['diff', '--name-only', '--no-renames', base, committed])
    ).stdout
      .trim()
      .split(/\r?\n/)
      .sort();
    assert.deepEqual(changed, [
      'compose.yaml',
      'index.html',
      'js/motion-controls.js',
      'js/pause-controls.js',
    ]);
    const commandId = randomUUID(),
      instruction = 'Повтори независимое C4-ревью разрешённого объёма T-016 с точным Compose';
    const store = new C4SemanticStore(s.db),
      existing = store.current(run.id);
    const priorOperations = s.db.coordination
      .pending(project)
      .filter((op) => op.scopeKey === `c4.review:${run.id}`);
    const repeat =
      !existing ||
      existing.id === prepared.previousJob ||
      existing.state !== 'verified' ||
      existing.verdict?.implementation !== 'aligned' ||
      !['aligned', 'optional'].includes(existing.verdict?.category ?? '');
    if (repeat) {
      s.commands.accept('task.send', project, task, {
        commandId,
        text: `${instruction}. Это разрешённое владельцем продолжение T-016 после Stop. Сначала resume_task с command_id="${commandId}" и instruction="${instruction}". Прочитай read_project_memory source="${(await context.store.readTask(task)).path}" и get_c4_context. Владелец отдельно разрешил добавить существующий compose.yaml без изменения 1152 байт, SHA256 ${AG1_COMPOSE_SHA}. Контроллер сохранил точные байты в task checkout и сделал commit ${committed}; прежний JS rename и одна ссылка сохранены. Текущий результат включает ровно compose.yaml, index.html, js/pause-controls.js → js/motion-controls.js. Compose уже описан текущей принятой моделью 4; это фиксация существующего контура в Git, не принятие отклонённого пакета T-015 и не реализация planned. Девять вопросов остаются открытыми. Критерии только собственной T-016 переоткрыты для нового результата. Вызови review_c4 с фактическими данными, realized:[], затем закончи без polling. После независимого ревью только AG1_COMPOSE_REVIEW_READY и конец хода. Не менять файлы, критерии, архитектуру или модель; не выполнять shell/commit/submit_result/merge_task/propose_c4 до отдельного AG1_LOCAL_VERIFIED от контроллера.`,
      });
    }
    const job = await eventually(
      () => {
        const current = store.current(run.id);
        if (
          (!repeat || current?.id !== existing?.id) &&
          current?.id !== prepared.previousJob &&
          current &&
          ['failed', 'uncertain'].includes(current.state)
        )
          throw new Error(current.error ?? current.state);
        return current;
      },
      (current) =>
        (!repeat || current?.id !== existing?.id) &&
        current?.id !== prepared.previousJob &&
        current?.state === 'verified' &&
        current.delivered === true,
      'new independent native review including the unchanged Compose',
      600000,
    );
    assert(job);
    assert.equal(job.verdict?.implementation, 'aligned');
    assert(['aligned', 'optional'].includes(job.verdict.category), job.verdict.summary);
    const review = await inspectSemanticC4Review(s.db, context, task, run.id);
    assert.deepEqual(review.realized, []);
    assert.equal((await s.c4.records(project, task)).length, 0);
    assert.equal(await context.git.head(), base);
    assert.deepEqual((await context.load()).c4, prepared.originalModel);
    const browser = await verifyC4CoordinationBrowser(s, project, directory, task);
    assert(browser.identicalPixels);
    return {
      task,
      run,
      base,
      committed,
      job,
      review,
      browser,
      composeSha256: AG1_COMPOSE_SHA,
      previousReviewPreserved: prepared.previousJob,
      sourcePaths: changed,
      priorReviewOperations: priorOperations.map((op) =>
        s.db.coordination.getOperation(project, op.id),
      ),
    };
  } finally {
    await handlers['task.interrupt'](project, task);
  }
}
