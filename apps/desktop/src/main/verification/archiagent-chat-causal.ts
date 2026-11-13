import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expand, incidentHash } from '@skaro/core';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { eventually } from './resource-workflow-observation';

/** Productive read-only task work and a real project chat race through the genuine shared controller. */
export async function verifyArchiagentChatCausal(s: Services, project: string) {
  const engine = s.runs['engine'],
    incidents = engine.incidents,
    handlers = sessionHandlers(s),
    task = 'T-010',
    stopped = 'T-011';
  const policy = incidents.policy.read(project),
    artifacts = await s.projects.get(project).load();
  const original = await s.runs.open(project, task),
    stoppedView = await s.runs.open(project, stopped);
  const stoppedTurns = stoppedView.timeline!.turns.length;
  assert.equal(
    s.db.getSetting<{ enabled: boolean }>(`execution.${stoppedView.run!.id}`, { enabled: false })
      .enabled,
    false,
  );
  const resource = s.db.resources
    .list(project)
    .find((r) => r.kind === 'environment' && r.owner.kind === 'task' && r.owner.id === task)!;
  assert(
    resource &&
      resource.consumers.length === 0 &&
      !policy.denied.some((r) => r.kind === 'environment.start' && r.target === resource.id),
  );
  const key = { projectId: project, taskId: task },
    description = await engine.environments.describe(key);
  assert(description.config?.ready);
  const url = expand(description.config.ready, description.identity),
    marker = `AG1_CAUSAL_${randomUUID().slice(0, 8)}`;
  const sources = [artifacts.architecture, ...artifacts.specs, ...artifacts.adrs]
    .filter((v) => !!v)
    .map((v) => v.path);
  const afterEvent = s.db.listEvents(project, 1)[0]?.id ?? 0;
  let revision: number | undefined, chat: string | undefined;
  try {
    await engine.environments.stop(key);
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(4000) }));
    revision = incidents.policy.save(
      project,
      {
        ...policy,
        mode: 'delegated',
        expiresAt: Date.now() + 10 * 60000,
        rules: [
          { kind: 'environment.start', target: resource.id, maxCostUsd: 0, sandbox: 'unchanged' },
        ],
      },
      policy.revision,
    ).revision;
    const commandId = randomUUID(),
      instruction = 'Проверь блокер сервиса и независимые документы Cat-pilot для AG-1';
    const count = original.timeline!.turns.length;
    s.commands.accept('task.send', project, task, {
      commandId,
      text: `${instruction}. Ограниченное реальное read-only поручение владельца. Сначала resume_task с command_id="${commandId}" и instruction="${instruction}"; затем report_task_blocker с cause="environment", code="service_unavailable", resource_id="${resource.id}", condition="environment-ready", reason="AG-1: общий реальный readiness ${url} недоступен". После регистрации не пытайся чинить сервис: независимо от HTTP проверь уже доступные архитектурные документы. Прочитай get_c4_context, затем последовательно read_project_memory для ${JSON.stringify(sources)} и кратко сравни фактический current/planned и ограничения двух спецификаций. Это полезная независимая часть исходной read-only задачи, без ожидания или polling. Не вызывай другие инструменты, shell, не меняй файлы/критерии и не сдавай результат. Закончи текущий ход кратким выводом по документам. Только после штатного автоматического продолжения от проверенного восстановления напиши ровно ${marker}_TASK и закончи без инструментов.`,
    });
    const row = await eventually(
      () =>
        incidents.store
          .list(project)
          .find(
            (r) =>
              r.state === 'open' &&
              r.subject.id === resource.id &&
              r.protocol?.ownerPolicyRevision === revision,
          ),
      (v) => !!v,
      'real report before independent task work',
      240000,
    );
    assert(row && row.protocol?.attempts === 0 && !row.protocol.decisionId);
    assert.equal(
      (await s.runs.open(project, task)).timeline!.status,
      'working',
      'Do not manufacture a busy task or attribute automatic repair to chat',
    );
    const reason = `${marker}: чат проверил точный технический remedy в действующих правах`;
    const view = await s.chats.create(
      project,
      { agent: 'codex', permissionMode: 'ask' },
      {
        commandId: randomUUID(),
        text: `Ограниченная реальная приёмка помощи проектного чата AG-1. Вызови read_project_incidents. Найди единственный текущий открытый service_unavailable инцидент с ownerPolicyRevision=${revision}, двумя разрешёнными границами: environment.start только точного target и maxCostUsd=0, sandbox unchanged. Если он один и действующая policy разрешает delegated действие, вызови decide_project_incident с его настоящим incident_id, allow=true, reason="${reason}" и expires_at из policy.expiresAt. Затем напиши ${marker}_CHAT и закончи. Не копируй сообщения задачи, не возобновляй её вручную, не меняй политики/файлы/критерии/модели, не вызывай shell. Разрешены только два названных инструмента. Если эффект уже выполнил автоматический координатор, честно сообщи это и не приписывай его чату.`,
      },
    );
    chat = view.id;
    const done = await eventually(
      () => s.chats.open(project, chat!),
      (v) => !!v.timeline.turns.at(-1)?.outcome && v.timeline.status === 'idle',
      'real causal project chat decision',
      240000,
    );
    assert.equal(done.timeline.turns.at(-1)?.outcome, 'done');
    const tools = done.timeline.items.filter((i) => i.kind === 'tool').map((i) => i.name);
    assert(
      tools.some((n) => n.includes('read_project_incidents')) &&
        tools.some((n) => n.includes('decide_project_incident')),
    );
    const decisions = s.db
      .listEvents(project, 1000)
      .filter(
        (e) => e.id > afterEvent && e.kind === 'coordinator_decision' && e.data.policy === revision,
      );
    assert.equal(decisions.length, 1, 'One actual grant, without deterministic replacement');
    assert.equal(
      decisions[0]!.data.reason,
      incidentHash(reason),
      'Only native chat authored this actual grant reason',
    );
    const resolved = await eventually(
      () => incidents.store.get(project, row.id),
      (r) => r.state === 'resolved',
      'effect verified through the shared controller',
      120000,
    );
    assert.equal(resolved.protocol?.attempts, 1);
    const resumed = await eventually(
      () => s.runs.open(project, task),
      (v) =>
        v.timeline!.turns.length > count &&
        v.timeline!.items.some(
          (i) =>
            i.kind === 'message' &&
            i.role === 'agent' &&
            i.text?.trim() === `${marker}_TASK` &&
            v.timeline!.turns.find((t) => t.id === i.turnId)?.outcome === 'done',
        ),
      'automatic task continuation from the chat-authorized effect',
      240000,
    );
    assert.equal((await s.runs.open(project, stopped)).timeline!.turns.length, stoppedTurns);
    assert.deepEqual((await s.runs.open(project, task)).task.criteria, original.task.criteria);
    assert((await fetch(url, { signal: AbortSignal.timeout(4000) })).ok);
    return {
      incident: row.id,
      operation: resolved.protocol!.operationId,
      chat,
      tools,
      reasonHash: incidentHash(reason),
      grant: decisions[0],
      oneEffect: true,
      automaticTaskContinuation: true,
      stoppedTaskPreserved: stopped,
      ownerForwardedMessages: 0,
      taskTurns: resumed.timeline!.turns.length - count,
    };
  } finally {
    await handlers['task.interrupt'](project, task);
    if (chat) await s.chats.interrupt(project, chat);
    await engine.environments.stop(key);
    if (revision !== undefined) {
      assert.equal(
        incidents.policy.read(project).revision,
        revision,
        'Do not overwrite concurrent owner edits',
      );
      incidents.policy.save(project, policy, revision);
    }
  }
}
