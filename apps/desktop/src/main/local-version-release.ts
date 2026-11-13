import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { git, resourceId, type AppDb } from '@skaro/core';
import type { ProjectContext } from './projects';
import type { LocalCandidateManifest } from './local-candidates';
import { requireMemoryPath } from './project-memory-sources';

export async function localVersionRelease(
  db: AppDb,
  dataDir: string,
  context: ProjectContext,
  manifest: LocalCandidateManifest,
  targetId: string,
): Promise<string> {
  const release = join(dataDir, 'local-versions', context.id, manifest.tree);
  await mkdir(dirname(release), { recursive: true });
  const existing = await git(context.root, ['worktree', 'list', '--porcelain']);
  if (
    !existing.stdout
      .replaceAll('\\', '/')
      .split(/\r?\n/)
      .includes('worktree ' + release.replaceAll('\\', '/'))
  )
    await context.git.createDetachedWorktree(release, manifest.head);
  const canonical = await requireMemoryPath(dataDir, release);
  const identity = {
    projectId: context.id,
    kind: 'worktree' as const,
    identity: { path: canonical },
  };
  if (!db.resources.get(resourceId(identity)))
    db.resources.register({
      ...identity,
      owner: { kind: 'project', id: context.id },
      purpose: 'worktree',
      preservation: 'persistent',
      ownership: 'registered',
      generation: 1,
      consumers: [],
      state: 'retained',
      source: { commit: manifest.head, recovery: `local-target:${targetId}` },
    });
  if (
    (await context.git.head('HEAD', release)) !== manifest.head ||
    (await git(release, ['rev-parse', 'HEAD^{tree}'])).stdout.trim() !== manifest.tree ||
    (await git(release, ['status', '--porcelain'])).stdout.trim()
  )
    throw new Error('Installed release manifest does not match Git');
  return release;
}
