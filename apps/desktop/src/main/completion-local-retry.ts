import { LocalChangesChangedError } from '@skaro/core';
import type { IntegrationOperation } from './integration-model';
import type { CompletionHooks } from './completion-coordinator';
import { acceptedResult } from './completion-results';
import { prepareLocalIntegration } from './integration-local-changes';

/** A moving base can introduce branch conflicts as well as new local edits. Both stay owned. */
export async function retryLocalIntegration(
  hooks: CompletionHooks,
  previous: IntegrationOperation,
  error: unknown,
) {
  const context = hooks.deps.projects.get(previous.projectId);
  previous.state = 'stale';
  hooks.integrations.save(previous);
  context.invalidate();
  const artifacts = await context.load();
  const results = [];
  for (const original of previous.results) {
    const task = artifacts.tasks.find((task) => task.id === original.taskId);
    if (!task || task.status !== 'review' || task.archived)
      throw new Error('The local resolution task is no longer awaiting publication.');
    results.push(await acceptedResult(hooks.deps.db, context, task));
  }
  return prepareLocalIntegration(
    context,
    artifacts,
    hooks.integrations,
    results,
    previous.message ?? results[0]!.message,
    {
      localChanges: [
        ...previous.localChanges!.paths,
        ...(error instanceof LocalChangesChangedError ? error.paths : []),
      ],
    },
  );
}
