import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ArtifactStore, git, type MergeOptions, type ProjectArtifacts } from '@skaro/core';
import type { ProjectContext } from './projects';
import { CompletionStore, criteriaRevision, type CompletionOperation } from './completion-store';
import { taskSections } from './task-body';
import { assertResultUnchanged } from './completion-results';
import type { IntegrationService } from './integration-service';
import type { IntegrationOperation } from './integration-model';
import { assertPublicationDependencies } from './completion-dependencies';
import { withCompletionCheckout } from './completion-checkout';
import { runChecks } from './check-runner';
import { prepareC4Publication, c4PublicationPaths, writeC4Publication } from './c4-publication';
import { validateC4Code } from '@skaro/core';

/** What every publication does besides Git: task metadata, guards and the durable record. */
async function publication(
  context: ProjectContext,
  artifacts: ProjectArtifacts,
  store: CompletionStore,
  operation: CompletionOperation,
  message: string,
) {
  const tasks = operation.results.map((result) => {
    const task = artifacts.tasks.find((item) => item.id === result.taskId);
    if (!task) throw new Error(`Task ${result.taskId} was removed`);
    return task;
  });
  const architecture = await prepareC4Publication(
    context,
    artifacts,
    operation.results.flatMap((result) => result.c4?.realized ?? []),
  );
  return {
    base: operation.base,
    strategy: operation.strategy,
    message:
      operation.results.length > 1
        ? `${message.split('\n\n')[0]}\n\n${operation.results.map((result) => result.message).join('\n')}`
        : message,
    managedPaths: [...tasks.map((task) => task.path), ...c4PublicationPaths(architecture)],
    guardPaths: [
      '.skaro/c4/model.json',
      '.skaro/architecture.md',
      '.skaro/config.yaml',
      ...artifacts.specs
        .filter((spec) => tasks.some((task) => task.spec === spec.id))
        .map((spec) => spec.path),
    ],
    allowMetadataOnly: true,
    beforeCommit: async (candidate) => {
      context.invalidate();
      assertPublicationDependencies(await context.load(), operation.results, store);
      const target = new ArtifactStore(candidate);
      const c4Files = await writeC4Publication(candidate, architecture);
      const c4Model = architecture
        ? JSON.parse(architecture.files.find((f) => f.path === 'c4/model.json')!.after)
        : artifacts.c4;
      if (c4Model) {
        const problems = await validateC4Code(candidate, c4Model);
        if (problems.length) throw new Error(problems.join('\n'));
      }
      for (const task of tasks) {
        const path = join(candidate, task.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, await readFile(join(context.root, task.path)));
        const current = await target.readTask(task.id);
        const result = operation.results.find((item) => item.taskId === task.id)!;
        if (
          current.status !== 'review' ||
          criteriaRevision(current) !== result.criteria ||
          taskSections(current.body).criteria.some((item) => !item.done)
        )
          throw new Error(`${task.id}: acceptance changed during merge`);
        await target.updateTask(task.id, { status: 'done' });
      }
      return [...tasks.map((task) => task.path), ...c4Files];
    },
    prepared: async ({ before, commit }) => {
      context.invalidate();
      assertPublicationDependencies(await context.load(), operation.results, store);
      for (const result of operation.results) {
        if (store.result(result.taskId)?.head !== result.head)
          throw new Error(`${result.taskId}: a newer result was submitted during verification`);
        await assertResultUnchanged(context, result);
      }
      // Protect the candidate from GC if the process dies before publishing it.
      await git(context.root, ['update-ref', `refs/skaro/completions/${operation.id}`, commit]);
      Object.assign(operation, { before, commit, state: 'prepared' });
      store.save(operation);
    },
  } satisfies Partial<MergeOptions>;
}

/**
 * Merge an accepted result with Git alone: the task was verified by its own agent in its own
 * environment. Only the checks the owner configured for the project run here.
 */
export async function publishCompletion(
  context: ProjectContext,
  artifacts: ProjectArtifacts,
  store: CompletionStore,
  operation: CompletionOperation,
  message: string,
): Promise<void> {
  const options = await publication(context, artifacts, store, operation, message);
  const verify = (candidate: string) => runChecks(candidate, artifacts.config.checks);
  const [result] = operation.results;
  // One accepted result goes into the base as it is; only a rebase needs a checkout to replay in.
  if (result && operation.results.length === 1 && operation.strategy !== 'rebase') {
    await context.git.merge({ ...options, branch: result.head, verify });
    return;
  }
  await withCompletionCheckout(
    context.git,
    operation.base,
    operation.results,
    async (checkout, head) => {
      await context.git.merge({
        ...options,
        branch: head,
        worktree: checkout,
        verify,
      });
    },
  );
}

/** Publish a candidate that an integration resolved and verified before merges went per task. */
export async function publishCandidate(
  context: ProjectContext,
  artifacts: ProjectArtifacts,
  store: CompletionStore,
  operation: CompletionOperation,
  message: string,
  integrations: IntegrationService,
  integration: IntegrationOperation,
): Promise<void> {
  await integrations.assertReady(integration);
  const head = integration.localChanges ? integration.publicationHead : integration.head;
  if (!head || (integration.localChanges && !integration.localIndexHead))
    throw new Error('Local resolution has no durable layer boundaries.');
  await context.git.merge({
    ...(await publication(context, artifacts, store, operation, message)),
    expectedBaseHead: integration.baseHead,
    branch: head,
    ...(integration.localChanges
      ? {
          localResolution: {
            snapshot: integration.localChanges,
            index: integration.localIndexHead!,
            working: integration.head,
            worktree: integration.worktree,
          },
        }
      : {}),
    worktree: integration.worktree,
    verify: async (candidate) => {
      // The exact code tree was checked in the durable environment. Publication adds only metadata.
      await integrations.assertReady(integration);
      const changed = await git(candidate, [
        'diff',
        '--cached',
        '--name-only',
        head,
        '--',
        '.',
        ':!.skaro',
      ]);
      if (changed.stdout.trim())
        throw new Error('Publication changed the verified integration code.');
    },
  });
}

/** Stopped candidates of the tasks no longer answer for them in their chats. */
export function retireCandidates(
  integrations: IntegrationService,
  projectId: string,
  ids: string[],
): void {
  for (const saved of integrations.deps.store.all(projectId))
    if (
      saved.purpose === 'publication' &&
      !saved.localChanges &&
      !saved.worker &&
      !saved.executor &&
      !['applied', 'stale'].includes(saved.state) &&
      saved.results.some((result) => ids.includes(result.taskId))
    ) {
      saved.state = 'stale';
      integrations.save(saved);
    }
}
