import { expect, it } from 'vitest';
import { setupEnvironmentTool } from '@skaro/mcp-server';
import { prepareEnvironmentSetup } from '../../../../packages/core/src/artifacts/environment-setup';

it('exposes initial setup to project chats and tasks, but not import or integration sessions', () => {
  const tool = setupEnvironmentTool(async (args) => ({
    text: JSON.stringify(prepareEnvironmentSetup(null, args)),
  }));
  expect(tool.available!({ kind: 'project_chat', projectId: 'p', chatId: 'c' })).toBe(true);
  expect(tool.available!({ kind: 'task', projectId: 'p', taskId: 'T-1', runId: 'r' })).toBe(true);
  expect(
    tool.available!({ kind: 'project_chat', projectId: 'p', chatId: 'c', importId: 'i' }),
  ).toBe(false);
  expect(tool.available!({ kind: 'integration', projectId: 'p', taskId: 'i', runId: 'r' })).toBe(
    false,
  );
});

it('passes the read revision and complete declaration to the actual config preparation', async () => {
  const tool = setupEnvironmentTool(async (args) => ({
    text: JSON.stringify(prepareEnvironmentSetup(null, args)),
  }));
  const scope = { kind: 'project_chat' as const, projectId: 'p', chatId: 'c' };
  const read = JSON.parse((await tool.call({}, scope)).text);
  expect(read.environment).toBeNull();
  expect((await tool.call({ environment: {} }, scope)).isError).toBe(true);
  const result = await tool.call(
    {
      environment: { start: 'docker compose up -d --wait', ports: [], env: {}, urls: {} },
      expected_revision: read.revision,
    },
    scope,
  );
  expect(JSON.parse(result.text).environment.start).toBe('docker compose up -d --wait');
  expect((await tool.call({}, { ...scope, kind: 'integration' })).isError).toBe(true);
});
