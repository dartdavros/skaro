import assert from 'node:assert/strict';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';

export const AC5_AUDIT_TITLE = 'Приёмка AC-5: восстановление общего сервиса Cat-pilot';
/** A real, explicitly owner-authorized acceptance task, never a seeded task or substitute backend. */
export async function prepareCoordinatorAudit(s: Services, projectId: string) {
  const context = s.projects.get(projectId),
    handlers = sessionHandlers(s);
  assert(
    !(await context.load()).tasks.some((t) => t.title === AC5_AUDIT_TITLE),
    'Do not duplicate the acceptance task',
  );
  const task = await context.store.createTask({
    title: AC5_AUDIT_TITLE,
    agent: 'codex',
    body: '## Цель\n\nПровести реальную read-only приёмку восстановления координатора AC-5 на Cat-pilot совместно с T-010. Не менять исходники проекта, зависимости и критерии продуктовых задач.\n\n## Критерии приёмки\n\n- [ ] Нативный Codex сообщил о фактической недоступности общего зарегистрированного сервиса.\n- [ ] Две задачи объединены одним инцидентом и одним решением владельца.\n- [ ] Штатный контроллер восстановил сервис и подтвердил реальный HTTP readiness.\n- [ ] Обе задачи получили продолжение после проверки; исходники и продуктовые критерии сохранены.\n',
  });
  context.invalidate();
  await handlers['task.setSettings'](projectId, task.id, {
    agent: 'codex',
    permissionMode: 'ask',
    planFirst: false,
    isolation: 'worktree',
  });
  const incidents = s.runs['engine'].incidents;
  const policy = incidents.policy.read(projectId);
  const cancelled = [];
  // The preceding failed AC-5 attempt minted this policy generation and stopped both tasks.
  for (const row of incidents.store.list(projectId))
    if (
      row.state === 'open' &&
      row.protocol?.ownerPolicyRevision === policy.revision - 1 &&
      row.protocol.code === 'service_unavailable' &&
      row.protocol.subscriptions.every((sub) => sub.taskId === 'T-010')
    ) {
      await handlers['incidents.cancel'](projectId, row.id);
      cancelled.push(row.id);
    }
  return {
    taskId: task.id,
    title: task.title,
    permissionMode: 'ask',
    isolation: 'worktree',
    cancelledOwnFailedIncidents: cancelled,
  };
}

/** An unfinished in-place product task correctly owns the root; use this audit's own checkout. */
export async function isolateCoordinatorAudit(s: Services, projectId: string) {
  const context = s.projects.get(projectId),
    handlers = sessionHandlers(s);
  const task = (await context.load()).tasks.find((t) => t.title === AC5_AUDIT_TITLE);
  assert(
    task && !s.db.listRuns(projectId, task.id).length,
    'Only change the audit before its first run',
  );
  await handlers['task.interrupt'](projectId, task.id);
  const before = await s.runs.open(projectId, task.id);
  await handlers['task.setSettings'](projectId, task.id, {
    ...before.settings,
    isolation: 'worktree',
  });
  const incidents = s.runs['engine'].incidents,
    policy = incidents.policy.read(projectId);
  const cancelled = [];
  for (const row of incidents.store.list(projectId))
    if (
      row.state === 'open' &&
      row.protocol?.ownerPolicyRevision === policy.revision - 1 &&
      row.protocol.code === 'service_unavailable' &&
      row.protocol.subscriptions.every((sub) => sub.taskId === 'T-010')
    ) {
      await handlers['incidents.cancel'](projectId, row.id);
      cancelled.push(row.id);
    }
  return {
    taskId: task.id,
    isolation: 'worktree',
    criteriaPreserved: true,
    cancelledOwnFailedIncidents: cancelled,
  };
}
