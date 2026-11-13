import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { git } from '@skaro/core';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { CompletionStore } from '../completion-store';
import { C4SemanticStore } from '../c4-semantic-store';
import { AUTO_MERGE_KEY } from '../../shared/ipc';
import { latestC4LiveProof } from './c4-live-proof';
import { eventually } from './resource-workflow-observation';
import { monitorC4Publication } from './c4-publication-checkpoint';

/** Submit only the inspected real rename through the original native worker and normal policy. */
export async function submitC4CoordinationTask(s: Services, project: string, directory: string) {
  const task = 'T-012',
    context = s.projects.get(project),
    handlers = sessionHandlers(s);
  const rename = await latestC4LiveProof(s.dataDir, project, 'rename');
  const guards = await latestC4LiveProof(s.dataDir, project, 'guards');
  const browser = await latestC4LiveProof(s.dataDir, project, 'browser');
  const run = s.db.latestRun(project, task)!;
  assert.equal(run.id, rename.proof.rename.run.id);
  assert.equal(run.id, guards.proof.guards.run);
  assert(browser.proof.browser.identicalPixels);
  const store = new CompletionStore(s.db, project);
  assert(!store.result(task), 'Do not submit or commit a second result');
  const review = new C4SemanticStore(s.db).current(run.id)!;
  assert(review.state === 'verified' && review.delivered);
  const autoMerge = s.db.getSetting<boolean | null>(AUTO_MERGE_KEY, null);
  const stopMonitor =
    autoMerge === true ? await monitorC4Publication(s, project, directory) : undefined;
  const commandId = randomUUID(),
    instruction = 'Сдай проверенное переименование T-012 штатным submit_result';
  s.commands.accept('task.send', project, task, {
    commandId,
    text:
      `C42_SUBMISSION_AUTHORIZED. ${instruction}. Это явное поручение владельца в ранее разрешённом объёме. Сначала resume_task с command_id="${commandId}" и instruction="${instruction}". ` +
      `Согласованный C4-пакет применён штатно, ревизия 1, 9 вопросов сохранены. Настоящий независимый Codex ${review.reviewer!.nativeSessionId} дал aligned для fingerprint ${review.fingerprint}, realized:[], без C4-карточки. ` +
      `Контроллер завершил реальные host-проверки: ${JSON.stringify(guards.proof.guards)}. Browser-проверка реального file:// Cat-pilot до/после на одном кадре дала одинаковые пиксели; CSS байты сохранены и обновлена только одна ссылка. ` +
      `Артефакты: ${rename.file}; ${guards.file}; ${browser.file}. Они проверены контроллером, не подменяют API. ` +
      'Ничего не меняй и не выполняй shell, коммиты или merge_task. Сохранённое независимое ревью уже актуально: повторять review_c4/propose_c4 не надо. Вызови get_c4_context, затем submit_result с доказательством по всем 3 исходным критериям и commitMessage=":art: refactor(css): rename base stylesheet to layout". ' +
      'Не утверждай, что будущие анимации или открытые вопросы решены. После ответа submit_result закончи ход; ручную карточку слияния сохранит действующая политика.',
  });
  const result = await eventually(
    async () => {
      const view = await s.runs.open(project, task);
      assert(
        !view.timeline?.interactions.some((i) => i.kind === 'approval'),
        'Submission needs no native shell permission',
      );
      const saved = store.result(task);
      return saved &&
        (view.timeline?.turns.at(-1)?.outcome ||
          view.timeline?.interactions.some((i) => i.kind === 'merge'))
        ? saved
        : undefined;
    },
    (value) => !!value,
    'native T-012 result capture',
    600000,
  );
  assert(result?.worktree);
  const status = (await context.store.readTask(task)).status;
  assert(['review', 'done'].includes(status));
  const fields = (
    await git(context.root, [
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      result.c4!.baseHead,
      result.head,
      '--',
      '.',
      ':(exclude).skaro',
    ])
  ).stdout
    .split('\0')
    .filter(Boolean)
    .sort();
  assert.deepEqual(fields, ['css/base.css', 'css/layout.css', 'index.html']);
  const blob = async (ref: string) => (await git(context.root, ['rev-parse', ref])).stdout.trim();
  assert.equal(
    await blob(`${result.c4!.baseHead}:css/base.css`),
    await blob(`${result.head}:css/layout.css`),
  );
  const source = await readFile(join(result.worktree, 'index.html'), 'utf8');
  assert(source.includes('css/layout.css') && !source.includes('css/base.css'));
  const afterReview = new C4SemanticStore(s.db).current(run.id)!;
  assert.equal(
    afterReview.id,
    review.id,
    'Submission must reuse independent facts, without another model call',
  );
  const view = await s.runs.open(project, task);
  assert(status === 'done' || view.timeline?.interactions.some((i) => i.kind === 'merge'));
  const proof = {
    result,
    autoMerge,
    review: review.id,
    reviewer: review.reviewer,
    mergeCard: view.timeline!.interactions.find((i) => i.kind === 'merge'),
    factsReused: true,
    sourceProofs: [rename.file, guards.file, browser.file],
  };
  await writeFile(join(directory, 'accepted-result.json'), JSON.stringify(proof, null, 2));
  await handlers['task.interrupt'](project, task);
  stopMonitor?.();
  return proof;
}
