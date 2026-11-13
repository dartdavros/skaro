import assert from 'node:assert/strict';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { coordinatorHistoryAudit, assertHistoryAudit } from './coordinator-history-audit';

/** Owner explicitly approved T-006 Skaro → Codex, keeping its existing checkout and history. */
export async function coordinatorHandoff(s: Services, projectId: string, data: string) {
  const taskId = 'T-006';
  const before = await s.runs.open(projectId, taskId);
  assert(before.run && before.settings.agent === 'skaro', 'Expected the approved source agent');
  assert.equal(before.timeline?.interactions.length ?? 0, 0, 'Preserve unanswered owner questions');
  const handlers = sessionHandlers(s);
  await handlers['task.interrupt'](projectId, taskId);
  const history = await coordinatorHistoryAudit(s.db, data, projectId);
  const { permissionMode, planFirst } = before.settings;
  await handlers['task.setSettings'](projectId, taskId, {
    agent: 'codex',
    isolation: before.run.worktree ? 'worktree' : 'in-place',
    permissionMode,
    planFirst,
  });
  const after = await s.runs.open(projectId, taskId);
  assert(after.run && after.settings.agent === 'codex');
  const successor = s.db.listRuns(projectId, taskId)[0]!;
  assert.equal(successor.previousRunId, before.run.id);
  assert.deepEqual(after.task.criteria, before.task.criteria);
  assert.equal(after.run.worktree, before.run.worktree);
  assert.equal(after.run.live, false);
  // The sole authorized settings change is recorded separately; log-byte preservation is audited.
  const current = await coordinatorHistoryAudit(s.db, data, projectId);
  const old = { ...history, nativeSettings: current.nativeSettings };
  await assertHistoryAudit(old, s.db, data, projectId);
  return {
    taskId,
    source: before.run.id,
    successor: successor.id,
    previousRunId: successor.previousRunId,
    agent: after.settings.agent,
    criteriaPreserved: true,
    historyPreserved: true,
    startedAutomatically: false,
  };
}
