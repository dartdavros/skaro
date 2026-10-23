import { MergeBlockedError, type ProjectArtifacts } from '@skaro/core';
import type { ProjectContext } from './projects';
import type { CompletionStore, CompletionOperation } from './completion-store';
import type { IntegrationService } from './integration-service';
import { prepareLocalIntegration } from './integration-local-changes';
import { publishCandidate, publishCompletion } from './completion-publication';

/** Dirty local paths enter the durable resolver, retaining the original merge authorization. */
export async function publishWithLocalChanges(
  context: ProjectContext,
  artifacts: ProjectArtifacts,
  store: CompletionStore,
  operation: CompletionOperation,
  message: string,
  integrations: IntegrationService,
): Promise<void> {
  try {
    await publishCompletion(context, artifacts, store, operation, message);
  } catch (error) {
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
