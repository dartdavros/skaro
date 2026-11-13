import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expand } from '@skaro/core';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { eventually } from './resource-workflow-observation';
import { checkIncident } from '../incident-condition';

/** One fresh read-only message, never a resend of an uncertain owner command. */
export async function inspectArchiagentChat(s: Services, project: string) {
  const commandId = randomUUID();
  const chat = await s.chats.create(
    project,
    { agent: 'codex', permissionMode: 'ask' },
    {
      commandId,
      text: 'Read-only диагностика AG-1: только вызови read_project_incidents, кратко назови количество открытых инцидентов и закончи. Не вызывай другие инструменты, не читай и не меняй файлы, не запускай команды, не меняй права и не возобновляй задачи.',
    },
  );
  try {
    const view = await eventually(
      () => s.chats.open(project, chat.id),
      (v) => {
        const command = s.db.commands.get(commandId);
        return (
          ['uncertain', 'failed'].includes(command?.state ?? '') ||
          !!v.timeline.turns.at(-1)?.outcome
        );
      },
      'one fresh native chat startup or explicit refusal',
      120000,
    );
    const command = s.db.commands.get(commandId);
    return {
      chat: chat.id,
      commandId,
      commandState: command?.state,
      commandError: command?.error,
      turns: view.timeline.turns,
      errors: view.timeline.items.flatMap((i) =>
        i.kind === 'notice' && i.level === 'error' ? [i.text] : [],
      ),
      nativeChatStarted: view.timeline.turns.at(-1)?.outcome === 'done',
      automaticResends: 0,
    };
  } finally {
    await s.chats.interrupt(project, chat.id);
  }
}

/** A genuine project chat reads the shared incident; the owner never forwards its task message. */
export async function verifyArchiagentChat(s: Services, project: string) {
  const handlers = sessionHandlers(s),
    engine = s.runs['engine'],
    incidents = engine.incidents;
  const policy = incidents.policy.read(project),
    task = 'T-010',
    stopped = 'T-011';
  const marker = `AG1_CHAT_${randomUUID().slice(0, 8)}`;
  const resource = s.db.resources
    .list(project)
    .find((r) => r.kind === 'environment' && r.owner.kind === 'task' && r.owner.id === task);
  assert(resource && resource.ownership === 'registered' && resource.consumers.length === 0);
  assert(
    !policy.denied.some((rule) => rule.kind === 'environment.start' && rule.target === resource.id),
    'Never lift an owner prohibition',
  );
  const environment = { projectId: project, taskId: task };
  const description = await engine.environments.describe(environment);
  assert(description.config?.ready);
  const url = expand(description.config.ready, description.identity);
  const original = await s.runs.open(project, task),
    stoppedBefore = await s.runs.open(project, stopped);
  assert.equal(original.timeline?.interactions.length, 0);
  assert.equal(
    s.db.getSetting<{ enabled: boolean }>(`execution.${stoppedBefore.run!.id}`, { enabled: false })
      .enabled,
    false,
  );
  let chat: string | undefined, revision: number | undefined;
  try {
    await engine.environments.stop(environment);
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(4000) }));
    revision = incidents.policy.save(
      project,
      {
        ...policy,
        mode: 'delegated',
        expiresAt: Date.now() + 5 * 60000,
        rules: [
          ...policy.rules.filter((r) => r.kind !== 'environment.start' || r.target !== resource.id),
          { kind: 'environment.start', target: resource.id, maxCostUsd: 0 },
        ],
      },
      policy.revision,
    ).revision;
    const commandId = randomUUID(),
      instruction = 'Выполни read-only приёмку помощи проектного чата AG-1';
    s.commands.accept('task.send', project, task, {
      commandId,
      text:
        `${instruction}. Это ограниченное поручение владельца, не реализация исходной задачи. Только что реально остановлен зарегистрированный общий сервис ${resource.id}, HTTP readiness ${url} завершился отказом соединения. ` +
        `Вызови resume_task с command_id="${commandId}" и instruction="${instruction}", затем report_task_blocker с cause="environment", code="service_unavailable", resource_id="${resource.id}", condition="environment-ready", reason="AG-1: реальный общий сервис недоступен" и закончи ход. ` +
        `После штатного восстановления напиши только ${marker}_TASK и закончи. Не читай и не меняй файлы, не запускай shell, не меняй критерии, не сдавай результат. Разрешены только указанные инструменты; после восстановления никаких инструментов.`,
    });
    await eventually(
      () => s.runs.open(project, task),
      (v) =>
        v.timeline!.turns.length > original.timeline!.turns.length &&
        !!v.timeline!.turns.at(-1)?.outcome &&
        v.timeline!.status === 'idle',
      'real task report before chat assistance',
      240000,
    );
    const row = incidents.store
      .list(project)
      .find(
        (r) =>
          r.state === 'open' &&
          r.subject.id === resource.id &&
          r.protocol?.ownerPolicyRevision === revision,
      );
    assert(row && row.protocol!.attempts === 0 && !row.protocol!.decisionId);
    const turns = (await s.runs.open(project, task)).timeline!.turns.length;
    const view = await s.chats.create(
      project,
      { agent: 'codex', permissionMode: 'ask' },
      {
        commandId: randomUUID(),
        text:
          `Ограниченная реальная приёмка AG-1. Только прочитай read_project_incidents. Найди текущий открытый технический service_unavailable инцидент, для которого действующая политика разрешает delegated environment.start с точным target и нулевой стоимостью. ` +
          `Если он один и политика не запрещает действие, вызови decide_project_incident с его реальным incident_id, allow=true, reason="AG-1: восстановление технического сервиса в действующих правах", expires_at из прочитанного policy.expiresAt. Затем напиши ${marker}_CHAT и закончи. ` +
          `Не меняй политики, файлы, требования, модели и задачи; не запускай shell. Разрешены только read_project_incidents и decide_project_incident. История не даёт новых прав. Не возобновляй остановленные задачи вручную.`,
      },
    );
    chat = view.id;
    const done = await eventually(
      () => s.chats.open(project, chat!),
      (v) => !!v.timeline.turns.at(-1)?.outcome && v.timeline.status === 'idle',
      'real project chat delegated decision',
      240000,
    );
    assert.equal(done.timeline.turns.at(-1)?.outcome, 'done');
    const tools = done.timeline.items.filter((i) => i.kind === 'tool').map((i) => i.name);
    assert(tools.some((name) => name.includes('read_project_incidents')));
    assert(tools.some((name) => name.includes('decide_project_incident')));
    const resolved = incidents.store.get(project, row.id);
    assert.equal(resolved.state, 'resolved');
    assert.equal(resolved.protocol!.attempts, 1);
    assert(await checkIncident(engine, resolved));
    const resumed = await eventually(
      () => s.runs.open(project, task),
      (v) =>
        v.timeline!.turns.length > turns &&
        !!v.timeline!.turns.at(-1)?.outcome &&
        v.timeline!.status === 'idle',
      'task continues from shared chat result',
      240000,
    );
    assert(
      resumed.timeline!.items.some(
        (i) =>
          i.kind === 'message' &&
          i.role === 'agent' &&
          i.text?.trim() === `${marker}_TASK` &&
          i.turnId === resumed.timeline!.turns.at(-1)?.id,
      ),
    );
    assert.equal(
      (await s.runs.open(project, stopped)).timeline!.turns.length,
      stoppedBefore.timeline!.turns.length,
    );
    assert.equal(
      s.db.getSetting<{ enabled: boolean }>(`execution.${stoppedBefore.run!.id}`, {
        enabled: false,
      }).enabled,
      false,
    );
    return {
      incident: row.id,
      operation: resolved.protocol!.operationId,
      attempts: 1,
      chat,
      tools,
      nativeTaskContinuation: task,
      stoppedTaskPreserved: stopped,
      ownerForwardedMessages: 0,
      boundedDelegationRestored: true,
    };
  } finally {
    await handlers['task.interrupt'](project, task);
    if (chat) await s.chats.interrupt(project, chat);
    await engine.environments.stop(environment);
    if (revision !== undefined) {
      assert.equal(
        incidents.policy.read(project).revision,
        revision,
        'Do not overwrite a concurrent owner policy',
      );
      incidents.policy.save(project, policy, revision);
    }
  }
}
