import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readEnvironment } from './environment.ts';
import type { ArtifactProblem } from './model.ts';
import { ArtifactStore } from './store.ts';

const section = {
  ports: ['API_PORT', 'UI_PORT'],
  env: { DATA_IMAGE: 'app:{name}', COMPOSE_FILE: 'compose.yaml|{root}/compose.task.yaml' },
  create: 'pwsh -File {root}/scripts/clone.ps1 -Name {name}',
  start: 'docker compose up -d --wait',
  ready: 'http://localhost:{UI_PORT}/health',
  urls: { frontend: 'http://localhost:{UI_PORT}' },
};

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('environment description', () => {
  it('reads the section and keeps it when the project settings are saved', async () => {
    dir = await mkdtemp(join(tmpdir(), 'skaro-environment-'));
    const store = new ArtifactStore(dir);
    const config = (await store.load()).config;
    const environment = readEnvironment(section, []);
    expect(environment).toEqual(section);
    await store.writeConfig({ ...config, environment: environment! });
    expect((await new ArtifactStore(dir).load()).config.environment).toEqual(section);
    expect(await readFile(join(dir, '.skaro', 'config.yaml'), 'utf8')).toContain('environment:');
  });

  it('refuses a description that would start a half-configured environment', () => {
    const problems: ArtifactProblem[] = [];
    expect(readEnvironment({ ...section, ready: 'http://localhost:{WEB}' }, problems)).toBe(
      undefined,
    );
    expect(readEnvironment({ ...section, start: '' }, problems)).toBe(undefined);
    expect(readEnvironment({ ...section, env: { COMPOSE_PROJECT_NAME: 'main' } }, problems)).toBe(
      undefined,
    );
    expect(problems.map((p) => p.message)).toEqual([
      'environment: unknown placeholder {WEB}',
      'environment: start must be a command',
      'environment: COMPOSE_PROJECT_NAME is set by Skaro',
    ]);
  });
});
