import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpHttpServer } from './server.ts';
import { mergeTaskTool, type MergeTaskArgs, type SkaroScope } from './tools.ts';

let server: McpHttpServer<SkaroScope>;
const calls: { args: MergeTaskArgs; scope: SkaroScope }[] = [];

beforeEach(async () => {
  calls.length = 0;
  server = new McpHttpServer<SkaroScope>({
    name: 'skaro',
    version: '0.0.0',
    tools: [
      mergeTaskTool(async (args, scope) => {
        calls.push({ args, scope });
        return { text: 'Confirmation card shown to the user.' };
      }),
    ],
  });
  await server.listen();
});

afterEach(() => server.close());

async function connect(headers: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }),
  );
  return client;
}

describe('McpHttpServer', () => {
  it('serves tools to the official MCP client, scoped by the session token', async () => {
    const task = server.grant({ kind: 'task', projectId: 'p1', taskId: 'T-001', runId: 'r1' });
    const client = await connect(task.headers);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['merge_task']);

    const result = await client.callTool({ name: 'merge_task', arguments: { summary: 'Done.' } });
    expect(result.content).toEqual([
      { type: 'text', text: 'Confirmation card shown to the user.' },
    ]);
    expect(calls).toEqual([
      {
        args: { summary: 'Done.' },
        scope: { kind: 'task', projectId: 'p1', taskId: 'T-001', runId: 'r1' },
      },
    ]);
    await client.close();

    // A project chat does not see merge_task.
    const chat = server.grant({ kind: 'project_chat', projectId: 'p1', chatId: 'c1' });
    const chatClient = await connect(chat.headers);
    expect((await chatClient.listTools()).tools).toEqual([]);
    await chatClient.close();
  });

  it('turns handler errors into tool errors', async () => {
    server = new McpHttpServer<SkaroScope>({
      name: 'skaro',
      version: '0.0.0',
      tools: [mergeTaskTool(() => Promise.reject(new Error('worktree is gone')))],
    });
    await server.listen();
    const grant = server.grant({ kind: 'task', projectId: 'p1', taskId: 'T-001' });
    const client = await connect(grant.headers);
    const result = await client.callTool({ name: 'merge_task', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'worktree is gone' }]);
    await client.close();
  });

  it('refuses requests without a live token, from browsers, and other methods', async () => {
    const grant = server.grant({ kind: 'task', projectId: 'p1', taskId: 'T-001' });
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const post = (headers: Record<string, string>) =>
      fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body,
      });

    expect((await post({})).status).toBe(401);
    expect((await post({ Authorization: 'Bearer nope' })).status).toBe(401);
    expect((await post({ ...grant.headers, Origin: 'https://evil.example' })).status).toBe(403);
    expect((await fetch(server.url, { headers: grant.headers })).status).toBe(405);
    const ok = await post(grant.headers);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });

    grant.revoke();
    expect((await post(grant.headers)).status).toBe(401);
  });
});
