import assert from 'node:assert/strict';
import { BrowserWindow } from 'electron';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { AUTO_MERGE_KEY } from '../../shared/ipc';
import { CompletionStore } from '../completion-store';
import { C4SemanticStore } from '../c4-semantic-store';
import { candidateC4Model } from '../c4-candidate';
import { taskSections } from '../task-body';
import { verifyArchiagentCleanup } from './archiagent-cleanup-live';
import { coordinatorSourceAudit, coordinatorSourceAuditWithout } from './coordinator-source-audit';
import { eventually } from './resource-workflow-observation';
import { AG1_COMPOSE_SHA } from './archiagent-compose-scope';
import { restoreArchiagentTaskFormatting } from './archiagent-summary-repair';

/** Normal native submit_result and the existing merge policy own all publication effects. */
export async function publishArchiagentTechnical(s: Services, project: string, directory: string) {
  const prepared = JSON.parse(await readFile(join(directory, 'compose-review-proof.json'), 'utf8'));
  const installed = JSON.parse(
    await readFile(join(directory, 'local-before-acceptance-proof.json'), 'utf8'),
  );
  assert(prepared.passed && installed.passed);
  const technical = prepared.technical,
    local = installed.local,
    task = String(technical.task),
    context = s.projects.get(project),
    handlers = sessionHandlers(s);
  assert.equal(task, local.task);
  assert.equal(local.receipt.state, 'verified');
  const store = new CompletionStore(s.db, project);
  const unrelatedBefore = await coordinatorSourceAuditWithout(context.root, [
    'index.html',
    'js/pause-controls.js',
    'js/motion-controls.js',
  ]);
  const completed = store
    .operations()
    .findLast(
      (op) => op.state === 'completed' && op.results.length === 1 && op.results[0]?.taskId === task,
    );
  assert.equal(await context.git.head(), completed?.commit ?? technical.base);
  assert.equal(
    s.db.getSetting(AUTO_MERGE_KEY, false),
    true,
    'Preserve the actual automatic merge policy',
  );
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { sandbox: true, backgroundThrottling: false },
  });
  const target = s.db.collections
    .all<import('../../shared/local-versions').LocalVersionTarget>(
      `coordination.local-targets.${project}`,
    )
    .find((t) => t.id === 'cat-pilot-dev')!;
  let rollback = false;
  try {
    await window.loadURL(target.ready);
    if (!completed && store.result(task)?.head === technical.committed) {
      await restoreArchiagentTaskFormatting(s, project, directory);
      // The genuine native verdicts already exist. Resume their normal automatic publication.
      await s.runs['engine'].results.criteriaChanged(project, task);
    }
    if (store.result(task)?.head !== technical.committed) {
      const commandId = randomUUID(),
        instruction = 'Сдай проверенный технический результат AG-1';
      s.commands.accept('task.send', project, task, {
        commandId,
        text: `AG1_LOCAL_VERIFIED. ${instruction}. Это согласованная владельцем повторная штатная сдача T-016. Сначала resume_task с command_id="${commandId}" и instruction="${instruction}". Контроллер проверил текущие входы, commit ${technical.committed}, точный существующий compose.yaml 1152 байт SHA256 ${AG1_COMPOSE_SHA}, совпадение исходных байтов JS, одну ссылку, реальный browser без изменения пикселей, НОВЫЙ независимый Codex review ${technical.job.id}, fingerprint ${technical.job.fingerprint}: aligned, realized:[], без material-карточки. Старый принятый JS-only результат и его неудачная публикация остаются историей; текущая сдача включает разрешённый Compose. Immutable local candidate ${local.manifest.id} реально установлен в зарегистрированном cat-pilot-dev до Git-приёмки, настоящий HTTP/browser и SHA JS совпали, данные сохранены; base ${technical.base} до этого не менялся. Доказательства ${join(directory, 'compose-review-proof.json')} и ${join(directory, 'local-before-acceptance-proof.json')}. Все 3 обновлённых критерия выполнены контроллером. Не менять файлы, критерии вручную, архитектуру, вопросы, не выполнять shell/commit/merge_task и не повторять review_c4/propose_c4. Вызови get_c4_context, затем submit_result с доказательством каждого из 3 критериев и commitMessage=":wrench: chore(dev): version preview compose and rename motion controls". Сдача и слияние идут по действующей политике. Затем закончи ход; cleanup проверит контроллер.`,
      });
    }
    const operation =
      completed ??
      (await eventually(
        () =>
          store
            .operations()
            .findLast(
              (op) =>
                op.results.length === 1 &&
                op.results[0]?.taskId === task &&
                op.results[0]?.head === technical.committed &&
                ['completed', 'failed'].includes(op.state),
            ),
        (op) => !!op,
        'real normal publication of T-016',
        600000,
      ));
    assert(
      operation?.state === 'completed' && operation.commit,
      operation?.error ?? 'Publication is incomplete',
    );
    await handlers['task.interrupt'](project, task);
    context.invalidate();
    const artifacts = await context.load();
    const current = artifacts.tasks.find((t) => t.id === task)!;
    assert.equal(current.status, 'done');
    assert(taskSections(current.body).criteria.every((c) => c.done));
    const model = artifacts.c4!;
    assert.equal(model.revision, 5);
    assert.equal(model.questions.length, 9);
    const original = JSON.parse(
      await readFile(join(directory, 'technical-task-started.json'), 'utf8'),
    ).originalModel;
    const expected = await candidateC4Model(original, [], {
      root: context.root,
      base: technical.base,
      head: operation.commit,
    });
    expected.revision = 5;
    assert.deepEqual(model, expected);
    const changed = (
      await git(context.root, [
        'diff',
        '--name-only',
        '--no-renames',
        '-z',
        technical.base,
        operation.commit,
        '--',
        '.',
        ':(exclude).skaro',
      ])
    ).stdout
      .split('\0')
      .filter(Boolean)
      .sort();
    assert.deepEqual(changed, [
      'compose.yaml',
      'index.html',
      'js/motion-controls.js',
      'js/pause-controls.js',
    ]);
    const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha(await readFile(join(context.root, 'compose.yaml'))), AG1_COMPOSE_SHA);
    assert.equal(
      sha(await readFile(join(context.root, 'js/motion-controls.js'))),
      '079aa7a80f5e35b43a79c74d8d999ce68896ec188e4dc1e571081367997ac5bc',
    );
    assert.equal(
      sha(await readFile(join(context.root, 'index.html'))),
      '09e3091bc5c5c22477a56460c84a3f282d26f64cd196458fc0e4d97c4eb2da1a',
    );
    const unrelatedAfter = await coordinatorSourceAuditWithout(context.root, [
      'index.html',
      'js/pause-controls.js',
      'js/motion-controls.js',
    ]);
    assert.deepEqual(
      { files: unrelatedAfter.files, fingerprint: unrelatedAfter.fingerprint },
      { files: unrelatedBefore.files, fingerprint: unrelatedBefore.fingerprint },
      'Preserve actual pre-existing uncommitted root work',
    );
    const job = new C4SemanticStore(s.db).current(technical.run.id)!;
    assert.equal(job.id, technical.job.id, 'No repeated semantic model review at publication');
    assert.equal((await s.c4.records(project, task)).length, 0);
    const replay = await s.runs['engine'].merges.coordinator.merge(project, task);
    assert.equal(replay.commit, operation.commit);
    assert.equal(s.db.listMerges(project, task).length, 1);
    assert.equal(await context.git.head(), operation.commit);
    await writeFile(
      join(directory, 'publication-checkpoint.json'),
      JSON.stringify({ task, operation, modelRevision: model.revision, review: job.id }, null, 2),
    );
    const cleanup = await verifyArchiagentCleanup(s, project, directory);
    await writeFile(
      join(directory, 'permanent-after-task-cleanup.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
    const rolledBack = await handlers['local.rollback'](project, local.receipt.id);
    assert.equal(rolledBack.state, 'rolled_back');
    rollback = true;
    return {
      task,
      operation,
      cleanup,
      review: job.id,
      semanticCallsReused: true,
      modelRevision: 5,
      questions: 9,
      noMaterialQuestion: true,
      mergeRecordedOnce: true,
      replayIdempotent: true,
      localRollback: rolledBack,
      source: await coordinatorSourceAudit(context.root),
    };
  } finally {
    window.destroy();
    await handlers['task.interrupt'](project, task);
    if (!rollback) {
      await writeFile(
        join(directory, 'local-retained-after-publication-error.json'),
        JSON.stringify(
          {
            receipt: local.receipt.id,
            release: local.receipt.release,
            reason: 'Preserve real installed state until reconciliation',
          },
          null,
          2,
        ),
      );
    }
  }
}
