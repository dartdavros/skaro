import { inspectTaskTool } from './task-tool-receipts';
import type { AppDb } from '@skaro/core';
import type { SkaroScope, Tool } from '@skaro/mcp-server';
import { containsCommit } from './completion-results';
import { CompletionStore, type CompletionOperation } from './completion-store';
import type { ProjectContext } from './projects';
import { coordinationHash } from './project-coordinator-request';

/** Verify the exact request against a recorded publication and live base-branch ancestry. */
export async function recoverMergeOperation(
  db: AppDb,
  context: ProjectContext,
  publication: CompletionOperation,
) {
  const { mergeRequestId, commit, base, results } = publication;
  if (!mergeRequestId || !commit || publication.state !== 'completed' || results.length !== 1)
    return;
  if (
    inspectTaskTool(
      db,
      { kind: 'task', projectId: context.id, taskId: results[0]!.taskId },
      'merge_task',
      mergeRequestId,
    )
  )
    return;
  const operation = db.coordination.getOperation(context.id, mergeRequestId);
  const task = results[0]!.taskId;
  if (
    operation?.state !== 'uncertain' ||
    operation.action !== 'mcp.merge_task' ||
    operation.subject.kind !== 'task' ||
    operation.subject.id !== task ||
    !(await containsCommit(context, base, commit))
  )
    return;
  const current = db.coordination.getOperation(context.id, mergeRequestId);
  if (current?.state !== 'uncertain') return;
  return db.coordination.reconcile(context.id, mergeRequestId, {
    expectedRevision: current.revision,
    state: 'succeeded',
    evidence: {
      code: 'task_merge_publication_verified',
      refs: [{ ...operation.subject, version: commit }],
      fingerprint: coordinationHash([publication.id, base, commit]),
    },
  });
}

export function mergeRecoveryTool(
  db: AppDb,
  project: (id: string) => ProjectContext,
): Tool<SkaroScope> {
  return {
    name: 'reconcile_task_merge',
    description:
      'Inspect an interrupted merge request and its Git publication without repeating the merge. A project coordinator can inspect any task in its project. Task sessions can inspect their own requests.',
    available: (scope) =>
      !scope.importId &&
      ((scope.kind === 'task' && !!scope.taskId) ||
        (scope.kind === 'project_chat' && !!scope.chatId)),
    inputSchema: {
      type: 'object',
      properties: { operation_id: { type: 'string', minLength: 1 } },
      required: ['operation_id'],
      additionalProperties: false,
    },
    call: async (args, scope) => {
      const id = args.operation_id;
      const direct = typeof id === 'string' && inspectTaskTool(db, scope, 'merge_task', id);
      if (direct) {
        if (!direct.isError || direct.structuredContent?.state !== 'started') return direct;
        const linked = new CompletionStore(db, scope.projectId)
          .operations()
          .findLast(
            (entry) =>
              entry.mergeRequestId === id &&
              entry.state === 'completed' &&
              entry.commit &&
              entry.results.length === 1 &&
              (scope.kind !== 'task' || entry.results[0]!.taskId === scope.taskId),
          );
        if (
          linked?.commit &&
          (await containsCommit(project(scope.projectId), linked.base, linked.commit))
        )
          return {
            text: 'The recorded merge commit is in the base branch.',
            structuredContent: {
              operationId: id,
              commit: linked.commit,
              base: linked.base,
              publicationId: linked.id,
            },
          };
        return direct;
      }
      const operation = typeof id === 'string' && db.coordination.getOperation(scope.projectId, id);
      if (
        !operation ||
        operation.action !== 'mcp.merge_task' ||
        operation.subject.kind !== 'task' ||
        (scope.kind === 'task' && operation.subject.id !== scope.taskId)
      )
        return {
          text: 'The original task merge is outside this conversation scope.',
          isError: true,
        };
      const context = project(scope.projectId);
      const store = new CompletionStore(db, scope.projectId);
      const publications = store.operations();
      const linked = publications.findLast((entry) => entry.mergeRequestId === id);
      const current = (linked && (await recoverMergeOperation(db, context, linked))) ?? operation;
      const task = operation.subject.id;
      const known = publications
        .filter((entry) => entry.results.some((result) => result.taskId === task))
        .map(({ id, state, base, commit }) => ({ id, state, base, commit }));
      const accepted = store.result(task);
      const base = (await context.summary()).config.baseBranch;
      const acceptedHeadInBase = accepted
        ? await containsCommit(context, base, accepted.head)
        : undefined;
      return {
        text:
          current.state === 'uncertain'
            ? 'The original request still has no verified outcome. Use the publication and branch evidence below to diagnose it. Continue independent work.'
            : 'The original merge request state was read from the coordination journal.',
        structuredContent: {
          operationId: current.id,
          state: current.state,
          task,
          evidence: current.evidence,
          publicationId: linked?.id,
          knownPublications: known,
          base,
          acceptedHead: accepted?.head,
          acceptedHeadInBase,
        },
      };
    },
  };
}
