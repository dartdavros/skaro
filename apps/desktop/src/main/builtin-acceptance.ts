import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import type {
  RuntimeAcceptancePort,
  RuntimeAcceptanceState,
  ProcessAdmissionPort,
  SkaroScope,
} from '@skaro/timeline';
import type { TaskRunEngine } from './task-run-engine';
import { criteriaRevision, CompletionStore } from './completion-store';
import { inspectC4TaskReview, c4ReviewKey } from './c4-review';
import { readSubject } from './task-subject';
import { taskSections } from './task-body';
import { key } from './task-run-helpers';
import { assertResultUnchanged } from './completion-results';

/** Read-only view of existing task/completion/C4 services; no second acceptance state. */
export function builtinAcceptancePort(
  engine: TaskRunEngine,
  supplied: SkaroScope,
  admissions: Pick<ProcessAdmissionPort, 'requireActive'>,
): RuntimeAcceptancePort {
  const scope = structuredClone(supplied);
  if (scope.kind !== 'task' || !scope.taskId)
    throw new Error('Acceptance inspection requires a bound task scope');
  const taskId = scope.taskId;
  return {
    async inspect(admission, signal) {
      signal.throwIfAborted();
      await admissions.requireActive(admission, signal);
      signal.throwIfAborted();
      const context = engine.project(scope.projectId);
      context.invalidate();
      const task = await readSubject(context, taskId);
      const revision = criteriaRevision(task);
      const active = engine.active.get(key(scope.projectId, taskId));
      const runtime = engine.deps.db.getTaskRuntime(scope.projectId).get(taskId);
      const current =
        !!scope.runId &&
        !!active?.session &&
        active.run.id === scope.runId &&
        runtime?.runId === scope.runId &&
        !active.switching &&
        !engine.closing;
      const checkout = await realpath(
        current ? (active.run.worktree ?? context.root) : context.root,
      );
      const openDecisions = [
        ...new Set([
          ...engine.deps.db
            .listOpenInteractions(scope.projectId)
            .filter((item) => !item.runId || item.runId === scope.runId)
            .map((item) => item.id),
          ...(current ? active.timeline.state.interactions.map((item) => item.id) : []),
        ]),
      ].sort();
      const reasons: string[] = [];
      if (!current) reasons.push('The task has no matching admitted active run');
      if (task.status === 'done' || task.status === 'cancelled')
        reasons.push('The task is already finished');
      if (openDecisions.length) reasons.push('Owner decisions remain open');
      let c4: RuntimeAcceptanceState['c4'];
      let c4Inputs: unknown;
      try {
        const review = await inspectC4TaskReview(
          engine.deps.db,
          context,
          taskId,
          checkout,
          current ? scope.runId : undefined,
        );
        c4 = review.scope?.kind === 'artifacts' ? 'not-required' : 'current';
        c4Inputs = {
          change: review.changeHash,
          model: review.modelHash,
          base: review.baseHead,
          scope: review.scope,
        };
      } catch {
        signal.throwIfAborted();
        c4 = engine.deps.db.getSetting(c4ReviewKey(scope.projectId, taskId), null)
          ? 'stale'
          : 'missing';
        reasons.push('C4 review is missing or stale');
      }
      const result = new CompletionStore(engine.deps.db, scope.projectId).result(taskId);
      let resultCurrent = false;
      if (result) {
        try {
          await assertResultUnchanged(context, result);
          resultCurrent = true;
        } catch {
          signal.throwIfAborted();
        }
      }
      const state = {
        binding: { scope: structuredClone(scope), checkout },
        criteriaRevision: revision,
        criteria: taskSections(task.body).criteria.map((item, index) => ({
          id: `${scope.projectId}:${taskId}:${revision}:${index + 1}`,
          met: item.done,
          evidenceIds: [] as string[],
        })),
        openDecisions,
        c4,
        result: result
          ? result.criteria === revision && resultCurrent
            ? ('accepted' as const)
            : ('stale' as const)
          : ('not-submitted' as const),
        continuation: reasons.length
          ? ('blocked' as const)
          : runtime?.state === 'running'
            ? ('allowed' as const)
            : ('stopped' as const),
        reasons,
      };
      signal.throwIfAborted();
      await admissions.requireActive(admission, signal);
      signal.throwIfAborted();
      return {
        ...state,
        revision: createHash('sha256')
          .update(JSON.stringify({ scope, runtime, state, c4Inputs, result }))
          .digest('hex'),
      };
    },
  };
}
