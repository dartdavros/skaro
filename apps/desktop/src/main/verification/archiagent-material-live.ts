import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { eventually } from './resource-workflow-observation';
import { coordinationHash } from '../project-coordinator-request';

/** A real proposal about an existing open question, saved by the native workflow, never applied here. */
export async function prepareArchiagentMaterial(s: Services, project: string, directory: string) {
  const context = s.projects.get(project),
    handlers = sessionHandlers(s);
  const artifacts = await context.load(),
    title = 'Предложение AG-1: границы необязательного dev-контура Cat-pilot';
  assert(
    artifacts.c4?.revision === 4 && artifacts.c4.questions.some((q) => q.id === 'q-compose-scope'),
  );
  assert(!artifacts.tasks.some((t) => t.title === title), 'Do not duplicate an owner-review task');
  const task = await context.store.createTask({
    title,
    agent: 'codex',
    body: '## Цель\n\nПодготовить на решение владельца один согласованный архитектурный пакет по существующему открытому q-compose-scope. Это предложение, не принятое решение. Ничего не применять и не менять напрямую в проекте.\n\n## Критерии приёмки\n\n- [ ] Предложение основано на существующих compose.yaml, README.md и C4 ревизии 4.\n- [ ] Уточнены только границы необязательного read-only Nginx dev-просмотра; file:// и ADR-0001 сохранены.\n- [ ] Единый пакет с ADR/архитектурой/моделью ожидает решения владельца, без изменения current/planned и прочих открытых вопросов.\n',
  });
  context.invalidate();
  await handlers['task.setSettings'](project, task.id, {
    agent: 'codex',
    permissionMode: 'ask',
    planFirst: false,
    isolation: 'worktree',
  });
  await writeFile(
    join(directory, 'material-task.json'),
    JSON.stringify({ project, task: task.id, title }, null, 2),
  );
  const beforeModel = artifacts.c4;
  let packageId: string | undefined;
  try {
    const commandId = randomUUID(),
      instruction = 'Подготовь на рассмотрение один C4-пакет по q-compose-scope';
    s.commands.accept('task.send', project, task.id, {
      commandId,
      text:
        `${instruction}. Владелец ЕЩЁ НЕ ПРИНИМАЛ предлагаемое решение. Твоя задача только подготовить вариант, нормальным propose_c4 сохранить pending и ждать. Не применяй пакет, не вызывай submit_result или merge_task, не меняй проектные файлы напрямую, не запускай shell/сервисы/браузеры. ` +
        `Разрешены get_c4_context, read_project_memory, propose_c4 и при необходимости resume_task с command_id="${commandId}" и instruction="${instruction}". Получи настоящую модель/схему и полные документы. ` +
        `Предлагаемое решение: «Необязательный локальный Nginx/Docker Compose используется только для read-only dev-просмотра реальных исходников. Это не публичный production runtime, backend, БД или сборка. Основной способ file:// по ADR-0001 сохраняется. Наличие конфигурации не означает запуск или readiness; такие факты требуют отдельного runtime evidence». ` +
        `Предложи ADR-0002 по этому тексту и согласованную вставку в architecture.md. Если ADR-0002 занят — остановись и сообщи, номер не подменяй. В предполагаемом after ADR может быть accepted только как результат будущего owner Apply; до решения всё pending. ` +
        `Complete model: base_revision=4, revision=5; сохрани все element/relationship/view ID, названия, тексты, code bindings и current/planned. Допустимы только необходимые ссылки на новый ADR у затронутых dev-элементов/связей/представлений и удаление q-compose-scope из предполагаемого after при принятии ADR. Все остальные 8 вопросов без изменений. Не объявляй readiness, совместимость браузеров или planned-функции реализованными. ` +
        `В documents допускаются только полная architecture.md и новый adr/0002-dev-preview.md. Не переписывай спецификации, бриф, старый ADR или код. Сохрани ОДИН настоящий pending пакет через propose_c4, не дублируй документы отдельными предложениями. После сохранения закончи ход и жди решения владельца.`,
    });
    const record = await eventually(
      () => s.c4.records(project),
      (records) => records.some((r) => r.scope.taskId === task.id && r.item.state === 'pending'),
      'real native material architecture proposal',
      360000,
    ).then((records) =>
      records.find((r) => r.scope.taskId === task.id && r.item.state === 'pending')!,
    );
    assert.equal(record.protocol, 'impact-v1');
    packageId = record.item.id;
    const after = await s.c4.reviewModel(project, record.item.id, 'after');
    assert(after, 'The real pending package must contain its complete model');
    assert.equal(after.revision, 5);
    for (const group of ['elements', 'relationships', 'views'] as const) {
      assert.deepEqual(
        after[group].map((v) => v.id).sort(),
        beforeModel[group].map((v) => v.id).sort(),
      );
      for (const old of beforeModel[group])
        assert.equal(after[group].find((v) => v.id === old.id)?.state, old.state);
    }
    assert.deepEqual(
      after.questions,
      beforeModel.questions.filter((q) => q.id !== 'q-compose-scope'),
    );
    const review = await handlers['c4.review'](project, record.item.id);
    const files = await s.c4.files(project, record.item.id),
      contents = [];
    for (const path of files)
      contents.push({
        path,
        before: await s.c4.file(project, record.item.id, path, 'before'),
        after: await s.c4.file(project, record.item.id, path, 'after'),
      });
    assert.deepEqual((await context.load()).c4, beforeModel);
    await writeFile(
      join(directory, 'material-owner-review.json'),
      JSON.stringify(
        {
          project,
          task: task.id,
          packageId: record.item.id,
          protocol: record.protocol,
          identity: coordinationHash(record.package),
          review,
          contents,
        },
        null,
        2,
      ),
    );
    return {
      task: task.id,
      packageId: record.item.id,
      protocol: record.protocol,
      ownerReview: join(directory, 'material-owner-review.json'),
      state: 'pending',
      applied: false,
    };
  } finally {
    await handlers['task.interrupt'](project, task.id);
    if (packageId) {
      const saved = (await s.c4.records(project)).find((record) => record.item.id === packageId);
      assert.equal(saved?.item.state, 'pending', 'Stop must retain the real material package');
      const pending = (await handlers['decisions.list'](project)).filter(
        (decision) => decision.kind === 'proposal' && decision.item.id === packageId,
      );
      assert.equal(pending.length, 1, 'One material owner decision survives native Stop');
      await writeFile(
        join(directory, 'material-pending-after-stop.json'),
        JSON.stringify(
          { task: task.id, packageId, decision: pending[0], state: saved!.item.state },
          null,
          2,
        ),
      );
    }
  }
}
