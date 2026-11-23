import { MergeBlockedError, type AppDb, type ProjectArtifacts } from '@skaro/core';
import type { ProjectContext } from './projects';
import type { CompletionStore, CompletionOperation, TaskResult } from './completion-store';
import type { IntegrationService } from './integration-service';
import { prepareLocalIntegration } from './integration-local-changes';
import { publishCandidate, publishCompletion, retireCandidates } from './completion-publication';
import { requireCoordinationDispatch } from './coordination-dispatch';
import { IntegrationPending } from './integration-model';

export function prepareConflictCandidate(
  integrations: IntegrationService,
  context: ProjectContext,
  artifacts: ProjectArtifacts,
  result: TaskResult,
  publish: boolean,
  message = result.message,
) {
  return integrations.prepare({
    projectId: context.id,
    taskId: result.taskId,
    target: result.taskId,
    purpose: 'publication',
    conflictRecovery: true,
    base: artifacts.config.baseBranch,
    results: [result],
    checks: artifacts.config.checks,
    message,
    publish,
  });
}

/** Dirty local paths enter the durable resolver, retaining the original merge authorization. */
export async function publishWithLocalChanges(
  context: ProjectContext,
  artifacts: ProjectArtifacts,
  store: CompletionStore,
  operation: CompletionOperation,
  message: string,
  integrations: IntegrationService,
  db: AppDb,
): Promise<void> {
  const ids = operation.results.map((result) => result.taskId);
  const repeated = ids.length === 1 && store.conflicts().includes(ids[0]!);
  const existing =
    repeated &&
    integrations.deps.store
      .all(context.id)
      .findLast(
        (item) =>
          item.conflictRecovery &&
          !item.localChanges &&
          item.results.length === 1 &&
          item.results[0]?.head === operation.results[0]?.head &&
          item.results[0]?.taskId === ids[0] &&
          !['stale', 'applied'].includes(item.state),
      );
  if (existing) {
    if (existing.worker || existing.executor || (existing.publish && existing.state !== 'ready'))
      throw new IntegrationPending(existing);
    if (
      existing.state === 'ready' &&
      existing.baseHead === (await context.git.head(operation.base))
    ) {
      requireCoordinationDispatch(db, context.id);
      operation.integrationId = existing.id;
      store.save(operation);
      await publishCandidate(context, artifacts, store, operation, message, integrations, existing);
      existing.state = 'applied';
      integrations.save(existing);
      return;
    }
  }
  if (!repeated) retireCandidates(integrations, context.id, ids);
  try {
    await publishCompletion(context, artifacts, store, operation, message);
    if (existing) retireCandidates(integrations, context.id, ids);
  } catch (error) {
    if (
      repeated &&
      error instanceof MergeBlockedError &&
      error.check.blockers.includes('conflicts')
    ) {
      requireCoordinationDispatch(db, context.id);
      const candidate = await prepareConflictCandidate(
        integrations,
        context,
        artifacts,
        operation.results[0]!,
        true,
        message,
      );
      operation.integrationId = candidate.id;
      store.save(operation);
      await publishCandidate(
        context,
        artifacts,
        store,
        operation,
        message,
        integrations,
        candidate,
      );
      candidate.state = 'applied';
      integrations.save(candidate);
      return;
    }
    if (
      !(error instanceof MergeBlockedError) ||
      !error.check.blockers.includes('dirty_base') ||
      error.check.blockers.some((blocker) => blocker !== 'dirty_base')
    )
      throw error;
    const local = await prepareLocalIntegration(
      context,
      artifacts,
      integrations,
      operation.results,
      message,
      error.check,
    );
    operation.integrationId = local.id;
    store.save(operation);
    await publishCandidate(context, artifacts, store, operation, message, integrations, local);
    local.state = 'applied';
    integrations.save(local);
  }
}
