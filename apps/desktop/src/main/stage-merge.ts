// The merge of a stage (task-stage.ts): what its card lists and how the commits of its tasks
// get the messages the user sees there.

import { git, type Milestone, type ProjectArtifacts, type Task } from '@skaro/core';
import type { StageMerge } from '@skaro/timeline';
import { taskSections } from './task-body';
import { stageTasks, type StageLedger } from './task-stage';
import { readinessAsList } from './task-subject';

/** Finished tasks of the stage that are not in the base branch yet: what a merge takes. */
export function mergingTasks(stage: Pick<Milestone, 'id'>, artifacts: ProjectArtifacts): Task[] {
  return stageTasks(stage, artifacts).filter((t) => t.status === 'review');
}

/** The tasks of the card, in the order of their commits, and the criteria that hold it back. */
export function stageMergeInfo(
  stage: Milestone,
  artifacts: ProjectArtifacts,
  ledger: StageLedger,
  options: { partial: boolean; previous?: StageMerge | undefined },
): StageMerge {
  const edited = new Map(options.previous?.tasks.map((t) => [t.id, t.message]));
  const position = (task: Task) => {
    const at = ledger.commits.findIndex((c) => c.taskId === task.id);
    return at < 0 ? ledger.commits.length : at;
  };
  const tasks = mergingTasks(stage, artifacts)
    .sort((a, b) => position(a) - position(b) || (a.order ?? 0) - (b.order ?? 0))
    .map((task) => ({
      id: task.id,
      title: task.title,
      message:
        edited.get(task.id) ??
        ledger.commits.find((c) => c.taskId === task.id)?.message ??
        `${task.id}: ${task.title}`,
    }));
  const unmet = options.partial
    ? []
    : taskSections(readinessAsList(stage.body))
        .criteria.filter((c) => !c.done)
        .map((c) => c.text);
  return { id: stage.id, tasks, partial: options.partial, unmet };
}

/**
 * Gives the first commit of each task the message from the card. Commits are written anew with
 * the same trees and authors, so nothing can conflict; a history that is not a straight line of
 * the ledger's commits is left as it is.
 */
export async function rewordStageCommits(
  worktree: string,
  base: string,
  ledger: StageLedger,
  info: StageMerge,
): Promise<StageLedger> {
  const wanted = new Map<string, string>();
  for (const task of info.tasks) {
    const first = ledger.commits.find((c) => c.taskId === task.id);
    const message = task.message.trim();
    if (first && message && message !== first.message) wanted.set(first.commit, message);
  }
  if (!wanted.size) return ledger;
  const fork = (await git(worktree, ['merge-base', base, 'HEAD'])).stdout.trim();
  const merges = (await git(worktree, ['rev-list', '--merges', `${fork}..HEAD`])).stdout.trim();
  const commits = (await git(worktree, ['rev-list', '--reverse', `${fork}..HEAD`])).stdout
    .split('\n')
    .filter(Boolean);
  if (merges || ![...wanted.keys()].every((sha) => commits.includes(sha))) return ledger;

  const moved = new Map<string, string>();
  let parent = fork;
  for (const sha of commits) {
    const message = wanted.get(sha);
    if (!message && !moved.size) {
      parent = sha;
      continue;
    }
    const shown = await git(worktree, ['show', '-s', '--format=%an%x00%ae%x00%aI%x00%B', sha]);
    const [name = '', email = '', date = '', body = ''] = shown.stdout.split('\0');
    const tree = (await git(worktree, ['rev-parse', `${sha}^{tree}`])).stdout.trim();
    const written = await git(
      worktree,
      ['commit-tree', tree, '-p', parent, '-m', message ?? body.trimEnd()],
      { env: { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date } },
    );
    parent = written.stdout.trim();
    moved.set(sha, parent);
  }
  // The tree of the tip is the same: the index and the files stay as they are.
  await git(worktree, ['reset', '--soft', parent]);
  return {
    ...ledger,
    commits: ledger.commits.map((c) => ({
      ...c,
      commit: moved.get(c.commit) ?? c.commit,
      message: wanted.get(c.commit) ?? c.message,
    })),
  };
}
