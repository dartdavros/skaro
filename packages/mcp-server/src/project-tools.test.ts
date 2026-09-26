import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectTools, type ProjectToolHandlers } from './project-tools.ts';
import { McpHttpServer } from './server.ts';
import { mergeTaskTool, type SkaroScope } from './tools.ts';

let server: McpHttpServer<SkaroScope>;
const calls: { tool: string; args: unknown }[] = [];

const record =
  (tool: string) =>
  async (args: unknown): Promise<{ text: string }> => {
    calls.push({ tool, args });
    return { text: `${tool} ok` };
  };

const handlers: ProjectToolHandlers = {
  context: async () => ({ text: '# Project' }),
  writeDoc: record('write_doc'),
  proposeAdr: record('propose_adr'),
  proposeMilestones: record('propose_milestones'),
  proposeTasks: record('propose_tasks'),
  updateTask: record('update_task'),
};

beforeEach(async () => {
  calls.length = 0;
  server = new McpHttpServer<SkaroScope>({
    name: 'skaro',
    version: '0.0.0',
    tools: [mergeTaskTool(async () => ({ text: '' })), ...projectTools(handlers)],
  });
  await server.listen();
});

afterEach(() => server.close());

async function connect(scope: SkaroScope): Promise<Client> {
  const { headers } = server.grant(scope);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }),
  );
  return client;
}

describe('project tools', () => {
  it('are offered to the project chat; a task run sees only the context', async () => {
    const chat = await connect({ kind: 'project_chat', projectId: 'p1', chatId: 'c1' });
    expect((await chat.listTools()).tools.map((t) => t.name)).toEqual([
      'get_project_context',
      'write_doc',
      'propose_adr',
      'propose_milestones',
      'propose_tasks',
      'update_task',
    ]);
    await chat.close();

    const task = await connect({ kind: 'task', projectId: 'p1', taskId: 'T-001', runId: 'r1' });
    expect((await task.listTools()).tools.map((t) => t.name)).toEqual([
      'merge_task',
      'get_project_context',
    ]);
    await task.close();
  });

  it('normalizes arguments and gives tasks refs that are unique per call', async () => {
    const chat = await connect({ kind: 'project_chat', projectId: 'p1', chatId: 'c1' });
    await chat.callTool({
      name: 'write_doc',
      arguments: { path: '.skaro/brief.md', content: '# Brief\n' },
    });
    await chat.callTool({
      name: 'propose_milestones',
      arguments: {
        milestones: [
          {
            title: 'API',
            goal: 'g',
            done_when: 'd',
            tasks: [{ title: 'A', goal: 'g', criteria: ['c'] }],
          },
          {
            title: 'UI',
            goal: 'g',
            done_when: 'd',
            tasks: [{ title: 'B', goal: 'g', criteria: ['c'], depends_on: ['m1-task-1'] }],
          },
        ],
      },
    });
    expect(calls).toEqual([
      { tool: 'write_doc', args: { path: 'brief.md', content: '# Brief' } },
      {
        tool: 'propose_milestones',
        args: {
          milestones: [
            {
              title: 'API',
              goal: 'g',
              doneWhen: 'd',
              tasks: [{ ref: 'm1-task-1', title: 'A', goal: 'g', criteria: ['c'], dependsOn: [] }],
            },
            {
              title: 'UI',
              goal: 'g',
              doneWhen: 'd',
              tasks: [
                {
                  ref: 'm2-task-1',
                  title: 'B',
                  goal: 'g',
                  criteria: ['c'],
                  dependsOn: ['m1-task-1'],
                },
              ],
            },
          ],
        },
      },
    ]);
    await chat.close();
  });

  it('returns bad arguments to the agent as a tool error', async () => {
    const chat = await connect({ kind: 'project_chat', projectId: 'p1', chatId: 'c1' });
    const result = await chat.callTool({
      name: 'propose_tasks',
      arguments: {
        tasks: [
          { ref: 'a', title: 'A', goal: 'g', criteria: ['c'] },
          { ref: 'a', title: 'B', goal: 'g', criteria: ['c'] },
        ],
      },
    });
    expect(result.isError).toBe(true);
    expect(calls).toEqual([]);
    await chat.close();
  });
});
