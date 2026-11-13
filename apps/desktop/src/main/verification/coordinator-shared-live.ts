import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expand } from '@skaro/core';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { checkIncident } from '../incident-condition';
import { eventually, requireReleased } from './resource-workflow-observation';
import { coordinatorSourceAudit } from './coordinator-source-audit';
import { AC5_AUDIT_TITLE, isolateCoordinatorAudit } from './coordinator-audit-task-live';
import { taskInputSnapshot } from '../task-preflight-inputs';

/** Two existing tasks audit one actual registered service; native workers report the outage. */
export async function coordinatorShared(
  s: Services,
  projectId: string,
  proof: Record<string, unknown>,
  label = 'AC-5',
) {
  const marker = `${label.replaceAll('-', '')}_${randomUUID().slice(0, 8)}`;
  const engine = s.runs['engine'],
    incidents = engine.incidents;
  const context = s.projects.get(projectId),
    artifacts = await context.load();
  const audit = artifacts.tasks.find((t) => t.title === AC5_AUDIT_TITLE);
  assert(audit, 'The owner-authorized real acceptance task must exist');
  if (!s.db.listRuns(projectId, audit.id).length) await isolateCoordinatorAudit(s, projectId);
  const taskIds = ['T-010', audit.id];
  for (const taskId of taskIds) await taskInputSnapshot(s.db, context, artifacts, taskId);
  const handlers = sessionHandlers(s);
  const originalPolicy = incidents.policy.read(projectId);
  for (const row of incidents.store.list(projectId))
    if (
      label === 'AC-5' &&
      row.state === 'open' &&
      row.protocol?.ownerPolicyRevision === originalPolicy.revision - 1 &&
      row.protocol.code === 'service_unavailable' &&
      row.protocol.subscriptions.every((sub) => taskIds.includes(sub.taskId))
    )
      await handlers['incidents.cancel'](projectId, row.id);
  const root = s.projects.get(projectId).root;
  const before = await Promise.all(taskIds.map((id) => s.runs.open(projectId, id)));
  const roots = [
    ...new Set([
      root,
      ...before.flatMap((view) => (view.run?.worktree ? [view.run.worktree] : [])),
    ]),
  ];
  const sourceBefore = await Promise.all(roots.map(coordinatorSourceAudit));
  for (const view of before) {
    assert.equal(view.settings.agent, 'codex');
    assert.equal(view.timeline?.interactions.length ?? 0, 0, 'Do not discard owner questions');
  }
  const environment = { projectId, taskId: 'T-010' };
  try {
    for (const id of taskIds) await handlers['task.interrupt'](projectId, id);
    const description = await engine.environments.describe(environment);
    assert(description.config?.ready);
    await engine.environments.stop(environment);
    const resource = s.db.resources
      .list(projectId)
      .find(
        (r) =>
          r.kind === 'environment' &&
          r.owner.kind === 'task' &&
          r.owner.id === 'T-010' &&
          r.ownership === 'registered',
      );
    assert(resource);
    assert.equal(resource.consumers.length, 0, 'Do not interrupt an existing service consumer');
    const url = expand(description.config.ready, description.identity);
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(4000) }));
    const policy = incidents.policy.save(
      projectId,
      { ...originalPolicy, mode: 'confirm', expiresAt: Date.now() + 3600000 },
      originalPolicy.revision,
    );
    const turns = new Map<string, number>();
    for (const taskId of taskIds) {
      const commandId = `${label}-shared-${randomUUID()}`;
      const instruction = `Проверь общий сервис в ограниченном read-only сценарии ${label}`;
      turns.set(taskId, (await s.runs.open(projectId, taskId)).timeline?.turns.length ?? 0);
      s.commands.accept('task.send', projectId, taskId, {
        commandId,
        text:
          `${instruction}. Это новое явное поручение владельца, а не реализация исходной задачи. ` +
          `Контроллер только что остановил реальный зарегистрированный сервис ${resource.id}, URL ${url}; фактический HTTP readiness завершился отказом соединения. ` +
          `Сервис является общим условием именно этого аудита для ${taskIds.join(' и ')}. ` +
          `Сначала вызови resume_task с command_id="${commandId}" и instruction="${instruction}". Затем вызови report_task_blocker: cause="environment", code="service_unavailable", resource_id="${resource.id}", condition="environment-ready", reason="${label}: реальный общий сервис ${url} остановлен контроллером, HTTP readiness недоступен". ` +
          `После отчёта закончи ход. После подтверждённого Skaro восстановления сервиса напиши только ${marker}_RESUMED_${taskId} и закончи. Не меняй и не читай файлы, не запускай shell/команды, не реализуй исходную задачу, не сдавай результат, не меняй критерии. Допустимы только указанные два инструмента; после восстановления никаких инструментов.`,
      });
      await eventually(
        () => s.runs.open(projectId, taskId),
        (view) =>
          view.timeline!.turns.length > turns.get(taskId)! &&
          !!view.timeline!.turns.at(-1)?.outcome,
        `native ${taskId} blocker turn`,
        240000,
      );
      process.send?.({ stage: 'native-shared-blocker-reported', taskId });
    }
    const row = await eventually(
      () =>
        incidents.store
          .list(projectId)
          .find(
            (r) =>
              r.state === 'open' &&
              r.subject.id === resource.id &&
              r.protocol?.ownerPolicyRevision === policy.revision &&
              r.protocol.subscriptions.length === 2,
          ),
      (r) => !!r?.protocol?.decisionId,
      'one shared incident and decision',
    );
    assert(row?.protocol?.decisionId);
    const decisionId = row.protocol.decisionId;
    assert.deepEqual(
      row.protocol.subscriptions.map((sub) => sub.taskId).sort(),
      [...taskIds].sort(),
    );
    assert.equal(row.protocol.attempts, 0);
    for (const taskId of taskIds) {
      await eventually(
        () => s.resources.holdings(projectId, `task:${taskId}`).length,
        (n) => n === 0,
        `actual ${taskId} transport teardown`,
        30000,
      );
      requireReleased(s, projectId, `task:${taskId}`);
    }
    const decisions = s.db.coordination.decisions
      .list(projectId)
      .filter((d) => d.subject.id === row.id && d.state === 'pending');
    assert.equal(decisions.length, 1);
    const resumeBefore = new Map(
      await Promise.all(
        taskIds.map(
          async (id) => [id, (await s.runs.open(projectId, id)).timeline!.turns.length] as const,
        ),
      ),
    );
    proof.shared = {
      incident: row.id,
      resource: resource.id,
      decisionId,
      subscriptions: row.protocol.subscriptions,
      actualUnavailableUrl: url,
      policyRevision: policy.revision,
      marker,
    };
    process.send?.({ stage: 'one-owner-approval-two-subscribers', incident: row.id });
    await handlers['task.respond'](
      projectId,
      row.protocol.subscriptions[0]!.taskId,
      `coordinator:${decisionId}`,
      { kind: 'approval', choice: 'allow_once' },
    );
    const resolved = incidents.store.get(projectId, row.id);
    assert.equal(resolved.state, 'resolved');
    assert.equal(resolved.protocol!.attempts, 1);
    assert.equal(await checkIncident(engine, resolved), true);
    assert.equal(
      s.db.coordination.getOperation(projectId, resolved.protocol!.operationId!)?.state,
      'succeeded',
    );
    await Promise.all(
      taskIds.map(async (taskId) => {
        const view = await eventually(
          async () => {
            const current = await s.runs.open(projectId, taskId);
            assert(!current.error, current.error);
            return current;
          },
          (v) =>
            v.timeline!.turns.length > resumeBefore.get(taskId)! &&
            !!v.timeline!.turns.at(-1)?.outcome,
          `verified native ${taskId} continuation`,
          240000,
        );
        assert(
          view.timeline!.items.some(
            (item) =>
              item.kind === 'message' &&
              item.role === 'agent' &&
              item.text?.trim() === `${marker}_RESUMED_${taskId}`,
          ),
        );
        await handlers['task.interrupt'](projectId, taskId);
        assert.deepEqual(
          view.task.criteria,
          before.find((v) => v.task.id === taskId)!.task.criteria,
        );
      }),
    );
    await assert.rejects(
      async () =>
        await handlers['task.respond'](projectId, 'T-010', `coordinator:${decisionId}`, {
          kind: 'approval',
          choice: 'allow_once',
        }),
    );
    assert.deepEqual(await Promise.all(roots.map(coordinatorSourceAudit)), sourceBefore);
    proof.sharedRecovery = {
      operation: resolved.protocol!.operationId,
      attempts: 1,
      verifiedRealReadiness: true,
      nativeContinuations: taskIds,
      duplicateAnswerRefused: true,
      criteriaPreserved: true,
      sourcePreserved: sourceBefore,
    };
  } finally {
    for (const id of taskIds) await handlers['task.interrupt'](projectId, id);
    await engine.environments.stop(environment);
    incidents.policy.save(projectId, originalPolicy, incidents.policy.read(projectId).revision);
  }
}
