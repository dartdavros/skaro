import { readFile } from 'node:fs/promises';
import { delimiter, isAbsolute, resolve } from 'node:path';
import type { EnvironmentConfig } from '@skaro/core';
import { memoryVersion, requireMemoryPath } from './project-memory-sources';

export async function taskEnvironmentVersion(
  root: string,
  config?: EnvironmentConfig,
): Promise<string> {
  if (!config) return memoryVersion(null);
  const declared = config.env.COMPOSE_FILE;
  const paths = declared
    ? declared
        .split(config.env.COMPOSE_PATH_SEPARATOR ?? delimiter)
        .map((path) => path.replaceAll('{root}', root).replaceAll('{worktree}', root))
    : [
        'compose.yaml',
        'compose.yml',
        'docker-compose.yaml',
        'docker-compose.yml',
        'compose.override.yaml',
        'compose.override.yml',
      ];
  const files: [string, string][] = [];
  for (const path of paths) {
    try {
      const canonical = await requireMemoryPath(
        root,
        isAbsolute(path) ? path : resolve(root, path),
      );
      files.push([canonical, memoryVersion(await readFile(canonical, 'utf8'))]);
    } catch (error) {
      if (!declared && (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
  return memoryVersion([config, files]);
}
