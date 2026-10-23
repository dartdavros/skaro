import { git, preserveLocalChanges, assertLocalChanges } from '@skaro/core';
import type { ProjectArtifacts } from '@skaro/core';
import type { ProjectContext } from './projects';
import type { IntegrationService } from './integration-service';
import type { IntegrationOperation } from './integration-model';
import type { TaskResult } from './completion-store';

export function integrationHeads(op: IntegrationOperation): string[] {
  return [
    ...op.results.map((result) => result.head),
    ...(op.localChanges ? [op.localChanges.staged, op.localChanges.working] : []),
  ];
}

export function checkpointLocalLayers(op: IntegrationOperation): void {
  if (!op.localChanges) return;
  if (op.cursor === op.results.length) op.publicationHead ??= op.head;
  if (op.cursor === op.results.length + 1) op.localIndexHead ??= op.head;
}

export async function prepareLocalIntegration(
  context: ProjectContext,
  artifacts: ProjectArtifacts,
  integrations: IntegrationService,
  results: TaskResult[],
  message: string,
  check: { localChanges?: string[] },
): Promise<IntegrationOperation> {
  const base = artifacts.config.baseBranch;
  const baseHead = await context.git.head(base);
  const paths = new Set(check.localChanges ?? []);
  for (const result of results) {
    const changed = await git(context.root, [
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      `${baseHead}...${result.head}`,
    ]);
    for (const path of changed.stdout.split('\0').filter(Boolean))
      if (path !== '.skaro' && !path.startsWith('.skaro/')) paths.add(path);
  }
  const localChanges = await preserveLocalChanges(context.root, baseHead, [...paths].sort());
  return integrations.prepare({
    projectId: context.id,
    taskId: results[0]!.taskId,
    purpose: 'publication',
    base,
    results,
    checks: artifacts.config.checks,
    localChanges,
    message,
    publish: true,
  });
}

export async function assertLocalIntegration(context: ProjectContext, op: IntegrationOperation) {
  if (op.localChanges) await assertLocalChanges(context.root, op.localChanges);
}

export function localResolutionInstructions(op: IntegrationOperation): string[] {
  if (!op.localChanges) return [];
  return [
    `This operation preserves the owner's uncommitted changes. Saved snapshot: ${op.localChanges.id}. ` +
      `Original staged commit: ${op.localChanges.staged}; working-file commit: ${op.localChanges.working}.`,
    `Merge inputs follow this exact order: accepted task results, saved staged changes, saved unstaged/untracked changes. ` +
      `Current input: ${integrationHeads(op)[op.cursor] ?? 'all inputs merged'}.`,
    'Preserve the intent of BOTH the accepted task and local edits. Resolve conflicts here and stage the resolution; ' +
      'Apply only the CURRENT input layer: do not pull later working-file changes into the staged layer. ' +
      'call verify_integration to continue to the next local layer and verify the final working tree. ' +
      'The owner does not need to stash, commit, edit Git files, or confirm the merge a second time. ' +
      'Skaro publishes only the task result; your reconciled local layers remain staged/unstaged in the main copy. ' +
      'Never change the main copy or discard either side wholesale. Original bytes and index are retained by Skaro.',
  ];
}
