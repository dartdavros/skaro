import { realpath } from 'node:fs/promises';
import { git } from './command.ts';
import { containsPath, hostPath, inspectContainers } from '../docker/containers.ts';
export { containsPath } from '../docker/containers.ts';

/** Existing containers retain mount dependencies even while stopped. */
export interface ContainerMounts {
  Name: string;
  Mounts: { Type: string; Source: string }[];
}

export const containerMounts: () => Promise<ContainerMounts[]> = inspectContainers;

export class WorktreeRemovalBlocked extends Error {
  constructor(path: string, reason: string) {
    super(`Worktree retained at ${path}: ${reason}`);
  }
}

export async function registeredWorktrees(repo: string): Promise<string[]> {
  return (await git(repo, ['worktree', 'list', '--porcelain', '-z'])).stdout
    .split('\0')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice(9));
}

export async function assertRemovableWorktree(
  repo: string,
  path: string,
  inspect: () => Promise<ContainerMounts[]> = containerMounts,
): Promise<void> {
  const target = await realpath(path);
  const main = await realpath(repo);
  if (containsPath(target, main))
    throw new WorktreeRemovalBlocked(path, 'this is the main working copy or its parent');
  const registered = await Promise.all(
    (await registeredWorktrees(repo)).map((entry) => realpath(entry).catch(() => entry)),
  );
  if (registered[0] && containsPath(target, registered[0]))
    throw new WorktreeRemovalBlocked(path, 'this is the main working copy or its parent');
  if (!registered.some((entry) => containsPath(entry, target) && containsPath(target, entry))) {
    throw new WorktreeRemovalBlocked(path, 'the folder is not a registered task worktree');
  }
  const changes = (
    await git(path, ['status', '--porcelain', '--untracked-files=all', '--ignored=matching'])
  ).stdout;
  if (changes.trim())
    throw new WorktreeRemovalBlocked(path, 'it contains changed, untracked or ignored files');
  let containers: ContainerMounts[];
  try {
    containers = await inspect();
  } catch {
    throw new WorktreeRemovalBlocked(path, 'Docker mount dependencies could not be checked');
  }
  // Existing junctions/symlinks must match the actual checkout, not only its spelling.
  containers = await Promise.all(
    containers.map(async (container) => ({
      ...container,
      Mounts: await Promise.all(
        container.Mounts.map(async (mount) => ({
          ...mount,
          Source:
            mount.Type === 'bind'
              ? await realpath(hostPath(mount.Source)).catch(() => hostPath(mount.Source))
              : mount.Source,
        })),
      ),
    })),
  );
  const users = containers.filter((container) =>
    container.Mounts.some(
      (mount) =>
        mount.Type === 'bind' &&
        (containsPath(target, mount.Source) || containsPath(mount.Source, target)),
    ),
  );
  if (users.length)
    throw new WorktreeRemovalBlocked(
      path,
      `Docker containers reference this folder: ${users.map((c) => c.Name).join(', ')}`,
    );
}
