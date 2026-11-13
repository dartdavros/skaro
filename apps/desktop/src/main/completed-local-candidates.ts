import type { Task } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import type { IntegrationOperation } from './integration-model';
import { CompletionStore, criteriaRevision, type TaskResult } from './completion-store';
import type { LocalCandidateManifest } from './local-candidates';
import type { LocalVersionReceipt } from '../shared/local-versions';
import { serializeTaskMutation } from './project-task-mutations';
import { publishedCheckout } from './worktree-publication';

/** Ready is not completion. Only this task's exact, still-current accepted result qualifies. */
export function publishedLocalCandidate(
  op: IntegrationOperation,
  task?: Task,
  result?: TaskResult,
) {
  return (
    op.purpose === 'local' &&
    op.state === 'ready' &&
    !op.publish &&
    !op.worker &&
    !op.executor &&
    op.verification?.head === op.head &&
    task?.id === op.taskId &&
    task.status === 'done' &&
    result?.taskId === task.id &&
    result.head === op.head &&
    result.criteria === criteriaRevision(task)
  );
}

/** End the disposable candidate lifecycle after publication; installed releases are independent. */
export async function retirePublishedLocalCandidate(
  ctx: TaskRunEngine,
  saved: IntegrationOperation,
) {
  if (saved.purpose !== 'local' || saved.state !== 'ready' || ctx.closing) return saved;
  const context = ctx.project(saved.projectId),
    db = ctx.deps.db;
  return serializeTaskMutation(context, () =>
    ctx.integrations.service.serial(`${saved.projectId}:${saved.taskId}:local`, () =>
      ctx.integrations.service.serial(saved.id, async () => {
        const op = ctx.integrations.store.find(saved.projectId, saved.id);
        if (!op || ctx.closing || ctx.integrations.executing(op.id)) return op ?? saved;
        const artifacts = await context.store.load(),
          store = new CompletionStore(db, op.projectId);
        const task = artifacts.tasks.find((t) => t.id === op.taskId);
        if (!publishedLocalCandidate(op, task, store.result(op.taskId))) return op;
        const installationPending = () =>
          db.coordination
            .pending(op.projectId)
            .some((operation) => operation.action === 'ipc.local.install');
        if (installationPending()) return op;
        const manifest = db.collections
          .all<LocalCandidateManifest>(`coordination.candidates.${op.projectId}`)
          .find(
            (m) => m.integrationId === op.id && m.head === op.head && m.inputs === op.inputVersion,
          );
        if (
          !manifest ||
          db.collections
            .all<LocalVersionReceipt>(`coordination.installations.${op.projectId}`)
            .some(
              (r) => r.manifestId === manifest.id && !['verified', 'rolled_back'].includes(r.state),
            )
        )
          return op;
        if (
          !(await publishedCheckout(
            db,
            op.projectId,
            context.root,
            op.head,
            artifacts.config.baseBranch,
          ))
        )
          return op;
        const fresh = ctx.integrations.store.find(op.projectId, op.id);
        const currentTask = await context.store.readTask(op.taskId);
        if (
          !fresh ||
          fresh.updatedAt !== op.updatedAt ||
          fresh.fingerprint !== op.fingerprint ||
          ctx.closing ||
          ctx.integrations.executing(op.id) ||
          installationPending() ||
          !publishedLocalCandidate(fresh, currentTask, store.result(op.taskId))
        )
          return fresh ?? op;
        fresh.state = 'stale';
        ctx.integrations.service.save(fresh);
        return fresh;
      }),
    ),
  );
}
