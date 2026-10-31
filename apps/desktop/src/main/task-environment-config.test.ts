import { AppDb, type EnvironmentConfig } from '@skaro/core';
import { configureEnvironmentTool } from '@skaro/mcp-server';
import { afterAll, afterEach, expect, it } from 'vitest';
import { configureEnvironment, environmentConfig } from './task-environment-config';
import { EnvironmentRegistry } from './task-environment-registry';

// Real application persistence and configuration validation; no services or substitute API.
const db = AppDb.open(':memory:');
const registry = new EnvironmentRegistry(db);
const key = { projectId: 'p', taskId: 'T-052' };
const other = { projectId: 'p', taskId: 'T-053' };
const config: EnvironmentConfig = {
  ports: ['API_PORT'],
  env: { COMPOSE_FILE: 'compose.yaml' },
  create: 'pwsh -File scripts/clone.ps1 {name}',
  start: 'docker compose up -d --wait backend-app db redis',
  ready: 'http://localhost:{API_PORT}/health/ready',
  urls: { api: 'http://localhost:{API_PORT}' },
};
const start = `${config.start} backend-admin`;

afterEach(() => {
  registry.remove(key);
  registry.remove(other);
});

it('persists declared source services through the MCP tool with stale-write protection', async () => {
  registry.ensure(key, 'project');
  const source = { project: 'main-project', services: ['postgres'] };
  const tool = configureEnvironmentTool(async (args) => ({
    text: JSON.stringify(configureEnvironment(registry, key, config, args)),
  }));
  const scope = { kind: 'task' as const, ...key, runId: 'r' };
  expect((await tool.call({ source }, scope)).isError).toBe(true);
  await tool.call({ source, expected_source: null }, scope);
  expect(environmentConfig(new EnvironmentRegistry(db), key, config).source).toEqual(source);
  expect(() =>
    configureEnvironment(registry, key, config, { source, expectedSource: null }),
  ).toThrow('source services changed');
  expect(config.source).toBeUndefined();
});

it('reads, saves and reloads a task launch command through the MCP tool without changing defaults', async () => {
  registry.ensure(key, 'project');
  registry.ensure(other, 'project');
  registry.update(key, { created: true, ports: { API_PORT: 32000 } });
  const tool = configureEnvironmentTool(async (args, scope) => ({
    text: JSON.stringify(
      configureEnvironment(
        registry,
        {
          projectId: scope.projectId,
          taskId: scope.taskId!,
        },
        config,
        args,
      ),
    ),
  }));
  const scope = { kind: 'task' as const, ...key, runId: 'r' };
  expect(JSON.parse((await tool.call({}, scope)).text).start).toBe(config.start);
  expect(
    JSON.parse((await tool.call({ start, expected_start: config.start }, scope)).text),
  ).toEqual({
    ...config,
    start,
  });
  const reloaded = new EnvironmentRegistry(db);
  expect(environmentConfig(reloaded, key, config)).toEqual({ ...config, start });
  expect(environmentConfig(reloaded, other, config)).toEqual(config);
  expect(config.start).not.toContain('backend-admin');
  expect(reloaded.find(key)).toMatchObject({ created: true, ports: { API_PORT: 32000 } });
  // Stopping or recreating data must not drop the saved command.
  registry.update(key, { created: false });
  expect(environmentConfig(registry, key, config).start).toBe(start);
  registry.remove(key);
  registry.ensure(key, 'project');
  expect(environmentConfig(registry, key, config).start).toBe(config.start);
});

it('rejects stale updates and invalid placeholders without changing the saved command', () => {
  registry.ensure(key, 'project');
  configureEnvironment(registry, key, config, { start, expectedStart: config.start });
  expect(() =>
    configureEnvironment(registry, key, config, {
      start: config.start,
      expectedStart: config.start,
    }),
  ).toThrow('launch command changed');
  expect(() =>
    configureEnvironment(registry, key, config, {
      start: 'docker compose up -d --wait {UNKNOWN_PORT}',
      expectedStart: start,
    }),
  ).toThrow('unknown placeholder');
  expect(() =>
    configureEnvironment(registry, key, config, {
      start: ' ',
      expectedStart: start,
    }),
  ).toThrow('start must be a command');
  expect(environmentConfig(registry, key, config).start).toBe(start);
});

it('rejects incomplete mutations and project-chat calls before the configuration handler', async () => {
  const tool = configureEnvironmentTool(() => {
    throw new Error('Invalid requests must not reach the configuration handler');
  });
  const scope = { kind: 'task' as const, ...key, runId: 'r' };
  for (const args of [
    { start },
    { expected_start: start },
    { start: '', expected_start: start },
    { ports: ['ADMIN_PORT'] },
    { expected_ports: ['API_PORT'] },
    { ports: [18001], expected_ports: ['API_PORT'] },
  ]) {
    expect((await tool.call(args, scope)).isError).toBe(true);
  }
  const projectChat = { kind: 'project_chat' as const, projectId: key.projectId };
  expect(tool.available?.(projectChat)).toBe(false);
  expect((await tool.call({}, projectChat)).isError).toBe(true);
});

it('adds documented port variables atomically and persists them without removing existing ports', async () => {
  registry.ensure(key, 'project');
  registry.ensure(other, 'project');
  const tool = configureEnvironmentTool(async (args) => ({
    text: JSON.stringify(configureEnvironment(registry, key, config, args)),
  }));
  const scope = { kind: 'task' as const, ...key, runId: 'r' };
  const next = JSON.parse(
    (await tool.call({ ports: ['ADMIN_PORT'], expected_ports: config.ports }, scope)).text,
  );
  expect(next.ports).toEqual(['API_PORT', 'ADMIN_PORT']);
  const reloaded = new EnvironmentRegistry(db);
  expect(environmentConfig(reloaded, key, config).ports).toEqual(next.ports);
  expect(environmentConfig(reloaded, other, config)).toEqual(config);
  expect(() =>
    configureEnvironment(registry, key, config, {
      ports: ['EXTRA_PORT'],
      expectedPorts: config.ports,
    }),
  ).toThrow('port declarations changed');
  expect(() =>
    configureEnvironment(registry, key, config, {
      start,
      expectedStart: config.start,
      ports: ['COMPOSE_PROJECT_NAME'],
      expectedPorts: next.ports,
    }),
  ).toThrow('is set by Skaro');
  expect(environmentConfig(registry, key, config).start).toBe(config.start);
  configureEnvironment(registry, key, environmentConfig(registry, key, config), {
    start,
    expectedStart: config.start,
  });
  expect(environmentConfig(registry, key, config).ports).toEqual(next.ports);
  expect(environmentConfig(registry, key, config).start).toBe(start);
  expect(config.ports).toEqual(['API_PORT']);
});

// The database is in memory, but is the same SQLite implementation used by Skaro.
afterAll(() => db.close());
