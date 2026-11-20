import { readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { memoryVersion } from './project-memory-sources';
import { taskEnvironmentVersion } from './task-environment-version';

it('versions each declared input from its launch directory, preserving order and missing evidence', async () => {
  const root = await realpath(resolve(import.meta.dirname, '../../../..'));
  const worktree = join(root, 'apps', 'desktop');
  const identity = { root, worktree, name: 'skaro', ports: {} };
  const config = {
    start: 'docker compose up',
    ports: [],
    urls: {},
    env: {
      COMPOSE_FILE: 'package.json|{root}/package.json|{worktree}/missing-compose-{name}.yaml',
      COMPOSE_PATH_SEPARATOR: '|',
    },
  };
  const task = join(worktree, 'package.json');
  const main = join(root, 'package.json');
  const missing = join(worktree, 'missing-compose-skaro.yaml');
  const fingerprint = async (path: string) => memoryVersion(await readFile(path, 'utf8'));
  expect(await taskEnvironmentVersion(identity, config)).toBe(
    memoryVersion([
      config,
      [
        [task, await fingerprint(task)],
        [main, await fingerprint(main)],
        [missing, null],
      ],
    ]),
  );
  expect(await taskEnvironmentVersion({ ...identity, worktree: root }, config)).not.toBe(
    await taskEnvironmentVersion(identity, config),
  );
  await expect(
    taskEnvironmentVersion(identity, {
      ...config,
      env: { COMPOSE_FILE: '{root}/../package.json' },
    }),
  ).rejects.toThrow('outside its registered scope');
});
