import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Services } from '../app-services';
import { AUTO_MERGE_KEY } from '../../shared/ipc';
import { CompletionStore } from '../completion-store';
import { inspectSemanticC4Review } from '../c4-semantic-gate';
import { C4SemanticStore } from '../c4-semantic-store';
import { latestC4LiveProof } from './c4-live-proof';
import { monitorC4Publication } from './c4-publication-checkpoint';
import { eventually } from './resource-workflow-observation';

/** The genuine automatic workflow owns publication; observer is armed before the first submit. */
export async function submitC4FaultTask(s: Services, project: string, directory: string) {
  const prepared = await latestC4LiveProof(s.dataDir, project, 'fault-task');
  const evidence = prepared.proof.faultTask,
    task = String(evidence.taskId);
  const context = s.projects.get(project),
    run = s.db.latestRun(project, task)!;
  assert.equal(run.id, evidence.run.id);
  assert.equal((await context.store.load()).c4?.revision, 2);
  assert(evidence.browser.identicalPixels);
  assert.equal(s.db.getSetting(AUTO_MERGE_KEY, false), true, 'Preserve the real automatic policy');
  assert(!new CompletionStore(s.db, project).result(task));
  const review = await inspectSemanticC4Review(s.db, context, task, run.id);
  const job = new C4SemanticStore(s.db).current(run.id)!;
  assert.equal(review.semanticReceipt, evidence.job.id);
  const stop = await monitorC4Publication(s, project, directory, task);
  const commandId = randomUUID(),
    instruction = 'Сдай проверенное JS-переименование для аварийной приёмки C4-2';
  await writeFile(
    join(directory, 'armed-publication.json'),
    JSON.stringify(
      {
        task,
        run: run.id,
        proof: prepared.file,
        review: review.semanticReceipt,
        originalRevision: 2,
        autoMerge: true,
        expectedExit: 73,
      },
      null,
      2,
    ),
  );
  try {
    s.commands.accept('task.send', project, task, {
      commandId,
      text:
        `C42_FAULT_SUBMISSION_AUTHORIZED. ${instruction}. Это явное разрешение владельца. Сначала resume_task с command_id="${commandId}" и instruction="${instruction}". ` +
        `Контроллер проверил точный Git rename, байты js/pause-controls.js равны исходному controls.js, index.html изменил только одну ссылку. Browser-сравнение реальных страниц дало одинаковые пиксели. Независимый Codex ${job.reviewer!.nativeSessionId}, review ${job.id}, fingerprint ${job.fingerprint}: aligned, realized:[], без ручной C4-карточки. ` +
        `Все исходные 3 критерия подготовки проверенного результата выполнены. Долговечная SQLite-копия проверена, наблюдатель настоящей публикации уже включён. Доказательства: ${prepared.file}. ` +
        'Не меняй файлы или критерии, не выполняй shell/commit/merge_task, не повторяй review_c4/propose_c4. Вызови get_c4_context, затем submit_result по всем трём критериям с commitMessage=":art: refactor(js): clarify pause controls script path". ' +
        'Не утверждай, что аварийная проверка уже прошла: её выполнит контроллер после реальной публикации. При потере связи никаких повторов или новых команд: контроллер сверит долговечный журнал и физические эффекты.',
    });
    await eventually(
      () =>
        new CompletionStore(s.db, project)
          .operations()
          .findLast((op) => op.results.some((r) => r.taskId === task) && op.state === 'completed'),
      (op) => !!op,
      'real automatic publication or controlled process exit',
      600000,
    );
    throw new Error(
      'Publication completed without the required observed crash boundary; do not claim crash acceptance',
    );
  } finally {
    stop();
  }
}
