import { lstat, readdir, realpath } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { git, type AppDb, type ResourceRegistration } from '@skaro/core';
import type { ProjectContext } from './projects';
import { environmentArtifacts } from './task-environment-finished';
import { stageIdOf } from './task-stage';
import { completedCheckout } from './worktree-retention-model';

export interface WorktreeObservation {
  registration: ResourceRegistration;
  present: boolean;
  reason: string;
  completed: boolean;
  branch?: string;
  head?: string;
}

/** Reads real filesystem/Git/task metadata; never creates a checkout or transfers ownership. */
export async function worktreeResourceInventory(
  db: Pick<AppDb, 'listRuns'>,
  dataDir: string,
  context: Pick<ProjectContext, 'id' | 'root' | 'store'>,
  onlyPath?: string,
): Promise<WorktreeObservation[]> {
  const root = resolve(dataDir, 'worktrees', context.id);
  const runs = db.listRuns(context.id);
  const artifacts = await environmentArtifacts(context);
  const paths = new Set(
    onlyPath
      ? [resolve(onlyPath)]
      : runs.flatMap((run) => (run.worktree ? [resolve(run.worktree)] : [])),
  );
  let listingFailed = false;
  try {
    for (const entry of onlyPath ? [] : await readdir(root, { withFileTypes: true }))
      if (entry.isDirectory() || entry.isSymbolicLink()) paths.add(resolve(root, entry.name));
  } catch (error) {
    listingFailed = (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
  if (listingFailed) paths.add(root);
  let registered: string[] = [];
  try {
    registered = (await git(context.root, ['worktree', 'list', '--porcelain', '-z'])).stdout
      .split('\0')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => resolve(line.slice(9)));
  } catch {
    // Unknown Git registration never authorizes cleanup.
  }
  const observations: WorktreeObservation[] = [];
  for (const path of paths) {
    const owners = runs.filter((run) => run.worktree && resolve(run.worktree) === path);
    const owner = owners[0];
    const id = owner ? (stageIdOf(owner) ?? owner.taskId) : basename(path);
    const registration: ResourceRegistration = {
      projectId: context.id,
      kind: 'worktree',
      identity: { path },
      owner: { kind: 'unknown', id: path },
      purpose: 'unknown',
      ownership: 'legacy-unverified',
      preservation: 'unknown',
      generation: 1,
      consumers: [],
      state: 'retained',
    };
    const result: WorktreeObservation = {
      registration,
      present: true,
      reason: 'ownership-unverified',
      completed: false,
    };
    observations.push(result);
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        result.reason = 'noncanonical-path';
        continue;
      }
      if (
        !owner ||
        path !== resolve(root, id) ||
        resolve(await realpath(path)) !==
          resolve(await realpath(dataDir), 'worktrees', context.id, id)
      )
        continue;
      if (!registered.includes(path)) {
        result.reason = 'git-registration-unavailable';
        continue;
      }
      const branch = (
        await git(path, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
      ).stdout.trim();
      const head = (await git(path, ['rev-parse', 'HEAD'])).stdout.trim();
      if (!owners.some((run) => run.branch === branch)) {
        result.reason = 'branch-mismatch';
        continue;
      }
      if (!artifacts) {
        result.reason = 'task-metadata-unavailable';
        continue;
      }
      registration.owner = { kind: 'task', id };
      registration.purpose = 'worktree';
      registration.ownership = 'registered';
      registration.preservation = 'disposable';
      registration.source = { commit: head, recovery: branch };
      result.branch = branch;
      result.head = head;
      result.completed =
        completedCheckout(artifacts.tasks, id) &&
        owners.every((run) => completedCheckout(artifacts.tasks, run.taskId));
      result.reason = result.completed ? 'completed-checkout' : 'unfinished-owner';
    } catch (error) {
      result.present = (error as NodeJS.ErrnoException).code !== 'ENOENT';
      result.reason = result.present ? 'inspection-unavailable' : 'path-absent';
    }
  }
  return observations;
}
