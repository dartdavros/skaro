import { parse } from 'yaml';
import { publicationRequest, type WorkflowPublication } from '@skaro/mcp-server';
import { git, taskBranch, type Task, type RunRecord } from '@skaro/core';
import { gh, githubRepository } from './ci-github';
import type { ProjectContext } from './projects';

export interface PublicationTarget extends WorkflowPublication {
  repository: string;
  base: string;
  branch: string;
  blob: string;
}

interface PullRequest {
  number: number;
  state: string;
  merged: boolean;
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { ref: string; repo: { full_name: string } };
}

function assertPublicationPullRequest(
  pr: PullRequest,
  request: WorkflowPublication,
  target: {
    repository: string;
    base: string;
    branch: string;
    taskId: string;
    legacyInPlace: boolean;
  },
) {
  const { repository, base, branch } = target;
  // Older in-place agents created the task-named branch in the main checkout themselves.
  const legacy = target.legacyInPlace && pr.head.ref === `skaro/task/${target.taskId}`;
  if (
    pr.number !== request.pullRequest ||
    (pr.head.ref !== branch && !legacy) ||
    pr.head.ref === base ||
    pr.head.sha !== request.head ||
    pr.base.ref !== base ||
    [pr.base.repo, pr.head.repo].some(
      (r) => r?.full_name.toLowerCase() !== repository.toLowerCase(),
    )
  )
    throw new Error(
      'The PR, source task, approved commit or target branch changed. Reconcile the publication before continuing.',
    );
  if (!pr.merged && pr.state !== 'open')
    throw new Error('The publication PR was closed without merging.');
}

/** All remote reads are scoped to the local project's origin. Never run a deployment. */
export async function inspectWorkflowPublication(
  context: ProjectContext,
  task: Task,
  run: RunRecord,
  input: WorkflowPublication,
) {
  if (run.taskId !== task.id || run.projectId !== context.id)
    throw new Error('The publication run does not belong to this task.');
  const request = publicationRequest(input);
  const config = await context.store.readConfig();
  const base = config.baseBranch;
  const repository = await githubRepository(context.root);
  const endpoint = `repos/${repository}`;
  const defaultBranch = (
    await gh(context.root, ['api', endpoint, '--jq', '.default_branch'])
  ).trim();
  if (defaultBranch !== base)
    throw new Error(
      'The configured base is not the GitHub default branch required for this workflow.',
    );
  const pr: PullRequest = JSON.parse(
    await gh(context.root, ['api', `${endpoint}/pulls/${request.pullRequest}`]),
  );
  const branch = run.branch ?? task.branch ?? taskBranch(config, task);
  assertPublicationPullRequest(pr, request, {
    repository,
    base,
    branch,
    taskId: task.id,
    legacyInPlace: !run.branch && !run.worktree && !task.branch,
  });
  if (!pr.merged && (await context.git.head(`refs/heads/${pr.head.ref}`)) !== request.head)
    throw new Error('The local task branch no longer matches the requested PR commit.');
  const entry = (await git(context.root, ['ls-tree', request.head, '--', request.workflow])).stdout;
  const blob = /^100(?:644|755) blob ([a-f0-9]{40})\t/.exec(entry)?.[1];
  if (!blob) throw new Error('The approved commit does not contain the requested workflow file.');
  const definition = parse((await git(context.root, ['cat-file', 'blob', blob])).stdout);
  const triggers = definition?.on;
  const manual = Array.isArray(triggers)
    ? triggers.includes('workflow_dispatch')
    : triggers && typeof triggers === 'object'
      ? Object.hasOwn(triggers, 'workflow_dispatch')
      : triggers === 'workflow_dispatch';
  if (!manual) throw new Error('The approved workflow has no workflow_dispatch trigger.');
  const target: PublicationTarget = { repository, base, branch: pr.head.ref, blob, ...request };
  if (!pr.merged) {
    // Execute through the agent's ordinary owner-authorized command path, including its permission policy.
    const command = [
      'gh',
      'pr',
      'merge',
      String(pr.number),
      '--repo',
      repository,
      '--' + config.merge.strategy,
      '--match-head-commit',
      request.head,
    ];
    return { state: 'awaiting_publication' as const, target, command };
  }
  const remote = JSON.parse(
    await gh(context.root, [
      'api',
      `${endpoint}/contents/${request.workflow}?ref=${encodeURIComponent(base)}`,
    ]),
  );
  if (remote.type !== 'file' || remote.sha !== blob)
    throw new Error('The remote base does not contain the approved workflow blob.');
  return { state: 'published' as const, target };
}

export function publicationReply(result: Awaited<ReturnType<typeof inspectWorkflowPublication>>) {
  const text =
    result.state === 'published'
      ? 'GitHub confirms the merged PR and exact workflow blob in the base branch. Verify the bound publication incident if present, then continue authorized outstanding checks. Task acceptance remains open.'
      : 'GitHub confirms the PR and its head. Check the recorded owner decision for this repository, PR, commit and target. If explicitly authorized, execute the supplied command once through the ordinary session command permissions, then recheck with the same publication arguments. A workflow dispatch or deployment requires its own authority. No task criteria have been changed.';
  return { text: text + '\n' + JSON.stringify(result), structuredContent: result };
}
