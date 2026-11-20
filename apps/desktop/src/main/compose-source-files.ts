import { existsSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

const DEFAULTS = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
const OVERRIDES = [
  'compose.override.yaml',
  'compose.override.yml',
  'docker-compose.override.yaml',
  'docker-compose.override.yml',
];

export function composeSourceFiles(worktree: string, variables: Record<string, string>): string[] {
  const selected = variables.COMPOSE_FILE;
  if (selected)
    return selected
      .split(variables.COMPOSE_PATH_SEPARATOR ?? delimiter)
      .filter(Boolean)
      .map((path) => resolve(worktree, path));
  const firstExisting = (names: string[]) =>
    names.map((name) => join(worktree, name)).find(existsSync);
  const base = firstExisting(DEFAULTS);
  return base ? [base, firstExisting(OVERRIDES)].filter((path): path is string => !!path) : [];
}
