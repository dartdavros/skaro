import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { background } from '../background/client';
import { eventually } from './resource-workflow-observation';
import { coordinatorSourceAudit } from './coordinator-source-audit';
import { c4PackageText } from '@skaro/core';
import { approveC4PreparationReads } from './c4-preparation-permissions';

const title = 'Приёмка C4-2: проверка принятой архитектуры Cat-pilot';
/** Owner explicitly authorized a real acceptance task and an unapplied baseline proposal. */
export async function prepareC4Coordination(s: Services, projectId: string, directory: string) {
  const context = s.projects.get(projectId),
    handlers = sessionHandlers(s);
  const before = await coordinatorSourceAudit(context.root);
  const task =
    (await context.load()).tasks.find((t) => t.title === title) ??
    (await context.store.createTask({
      title,
      agent: 'codex',
      body: '## Цель\n\nПровести реальную приёмку C4-2 на Cat-pilot: независимое ревью принятой архитектуры, точность scope, единое решение и восстановление. Пакет архитектуры и конкретное изменение кода применяются только после отдельного решения владельца. До него исходники не менять.\n\n## Критерии приёмки\n\n- [ ] Подготовлен и представлен владельцу реальный архитектурный пакет по существующим коду и документации.\n- [ ] Независимое C4-ревью проверено на точном fingerprint без ручного C4-вопроса для принятого решения.\n- [ ] Проверены scope/CAS, совместимость протокола и восстановление без повторных эффектов.\n',
    }));
  context.invalidate();
  await handlers['task.setSettings'](projectId, task.id, {
    agent: 'codex',
    permissionMode: 'ask',
    planFirst: false,
    isolation: 'worktree',
  });
  const previous = process.env['SKARO_C42_PREPARATION_CHAT'];
  const input = {
    commandId: randomUUID(),
    text: "Продолжи только одобренную подготовку одного C4-пакета Cat-pilot по реальному коду. Ничего не применяй, не меняй исходники/задачи, не делай коммит и не реализуй функции. Для чтения разрешены только точные команды: rg --files --hidden -g '!.git/**' -g '!node_modules/**' -g '!vendor/**'; Get-Content -Raw -LiteralPath 'index.html'; аналогичный Get-Content -Raw -LiteralPath для css/base.css, css/scene.css, css/cat.css, css/plane.css, js/controls.js и docs/storyboard.md. Без цепочек, pipe, скриптов и других команд. Документы .skaro и схему читай через get_c4_context. Подготовь один настоящий propose_c4 с current/planned согласно фактам и существующими документами, вопросы о неизвестном запиши в questions модели. Затем закончи ход; пакет ожидает владельца.",
  };
  const chat = previous
    ? (s.commands.accept('chat.send', projectId, previous, input), { id: previous })
    : await handlers['chat.create'](
        projectId,
        { agent: 'codex', permissionMode: 'ask' },
        {
          commandId: randomUUID(),
          text:
            'Владелец разрешил подготовить настоящий архитектурный пакет Cat-pilot для приёмки C4-2. Подготовь только один пакет propose_c4 по существующему коду и документам .skaro. Сначала вызови get_c4_context и прочитай реальные исходники и документы. Ничего не применяй; исходники, задачи, статусы документов и критерии не меняй, коммит не делай. Не создавай fixtures, заглушки и демонстрационные данные. Не реализуй задачи. ' +
            'Опиши фактические current и ещё не реализованные planned части честно; не объявляй требования выполненными по одному статусу задачи. Существующие неизвестные решения оформи questions модели с конкретными affects, не выдумывай ответы. Не придумывай серверы/БД/интеграции: это существующая статическая страница, проверь действительную структуру. Покрой требования действительных спецификаций, используй реальные файлы, сохраняй авторский текст и статусы. Используй стандартную C4-схему из get_c4_context и существующий визуальный язык сервиса. Создай пакет с существующими архитектурой и относящимися спецификациями как одно решение владельца; затем сообщи только ID пакета и закончи ход. Вопросы вне модели и другие изменения не нужны.',
        },
      );
  await writeFile(
    join(directory, 'preparation-status.json'),
    JSON.stringify({ taskId: task.id, chatId: chat.id }, null, 2),
  );
  process.send?.({ stage: 'real-preparation-started', taskId: task.id, chatId: chat.id });
  let record;
  try {
    record = await eventually(
      async () => {
        await approveC4PreparationReads(s, projectId, chat.id);
        return s.c4.records(projectId, chat.id);
      },
      (rows) => rows.some((r) => r.item.state === 'pending'),
      'real native Cat-pilot architecture proposal',
      600000,
    );
    assert.equal(record.length, 1, 'Exactly one connected owner decision');
    await handlers['chat.interrupt'](projectId, chat.id);
    const entry = record[0]!;
    assert.equal(entry.item.proposal.type, 'architecture');
    const pkg = await background(s.dataDir, 'c4.package', projectId, entry.item.id);
    await writeFile(join(directory, 'baseline-proposal.json'), JSON.stringify(pkg, null, 2));
    await writeFile(join(directory, 'baseline-proposal.md'), c4PackageText(pkg, 'after'));
    assert.deepEqual(await coordinatorSourceAudit(context.root), before);
    return {
      taskId: task.id,
      chatId: chat.id,
      itemId: entry.item.id,
      packageId: pkg.id,
      state: entry.item.state,
      summary: pkg.summary,
      files: pkg.files.map((f) => f.path),
      sourcePreserved: before,
      review: await s.c4.reviewPackage(projectId, entry.item.id),
    };
  } finally {
    await handlers['chat.interrupt'](projectId, chat.id);
  }
}
