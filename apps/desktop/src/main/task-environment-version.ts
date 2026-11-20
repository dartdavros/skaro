import { readFile } from 'node:fs/promises';
import {
  environmentVariables,
  type EnvironmentConfig,
  type EnvironmentIdentity,
} from '@skaro/core';
import { composeSourceFiles } from './compose-source-files';
import { isMemorySourcePath, memoryVersion, requireMemoryPath } from './project-memory-sources';

export async function taskEnvironmentVersion(
  identity: EnvironmentIdentity,
  config?: EnvironmentConfig,
): Promise<string> {
  if (!config) return memoryVersion(null);
  const { worktree, root } = identity;
  const variables = environmentVariables(identity, config);
  const files: [string, string | null][] = [];
  for (const path of composeSourceFiles(worktree, variables)) {
    const scope = [worktree, root].find((dir) => isMemorySourcePath(dir, path));
    if (!scope) throw new Error('Compose source is outside its registered scope');
    try {
      const canonical = await requireMemoryPath(scope, path);
      files.push([canonical, memoryVersion(await readFile(canonical, 'utf8'))]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // A missing declared input is evidence too. Its creation changes the version.
      files.push([path, null]);
    }
  }
  return memoryVersion([config, files]);
}
