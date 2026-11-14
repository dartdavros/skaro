import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readEnvironment, environmentTimeoutMs } from './environment.ts';
import type { ArtifactProblem } from './model.ts';
import { ArtifactStore } from './store.ts';

const section = {
  timeouts: { create: 7200, start: 5400, ready: 300 },
  source: { project: 'main-project', services: ['postgres'] },
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
  it('keeps long command budgets explicit and independent from readiness', () => {
    const config = readEnvironment(section, [])!;
    expect(environmentTimeoutMs(config, 'create')).toBe(7200000);
    expect(environmentTimeoutMs(config, 'start')).toBe(5400000);
    expect(environmentTimeoutMs(config, 'ready')).toBe(300000);
    const without = { ...config, timeouts: undefined };
    expect(environmentTimeoutMs(without, 'start')).toBeUndefined();
    expect(environmentTimeoutMs(without, 'create')).toBeUndefined();
  });

  it('rejects invalid or overflowing stage budgets rather than silently losing their deadlines', () => {
    for (const timeouts of [
      null,
      [],
      30,
      { start: 0 },
      { create: -1 },
      { start: 1.5 },
      { start: Infinity },
      { start: 2147484 },
      { strart: 3600 },
    ]) {
      const problems: ArtifactProblem[] = [];
      expect(readEnvironment({ ...section, timeouts }, problems)).toBeUndefined();
      expect(problems[0]?.message).toContain('timeouts');
    }
  });
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

  it('rejects declarations that bypass or duplicate tool-owned port allocation', () => {
    const problems: ArtifactProblem[] = [];
    expect(
      readEnvironment({ ...section, ports: ['API_PORT', 'API_PORT'] }, problems),
    ).toBeUndefined();
    expect(readEnvironment({ ...section, env: { API_PORT: '18001' } }, problems)).toBeUndefined();
    expect(problems.map((p) => p.message)).toEqual([
      'environment: ports must be unique',
      'environment: env must not override a port allocated by Skaro',
    ]);
  });

  it('rejects malformed source service declarations before they can be persisted', () => {
    for (const source of [
      null,
      {},
      { project: '-invalid', services: ['postgres'] },
      { project: 'main', services: [] },
      { project: 'main', services: ['--privileged'] },
    ]) {
      const problems: ArtifactProblem[] = [];
      expect(readEnvironment({ ...section, source }, problems)).toBeUndefined();
      expect(problems[0]?.message).toContain('source must name');
    }
  });
});
