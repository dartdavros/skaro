import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILTIN_CONTRACT_VERSIONS,
  DEFAULT_UPSTREAM_POLICY,
  type PermissionMode,
  type TimelineEvent,
} from '@skaro/timeline';
import { stopOwnedProcess, type OwnedProcess } from '@skaro/agent-runtime/process-identity';
import type { SkaroSessionOptions } from '../../../../packages/adapter-skaro/src/index.ts';
import { SkaroSession } from '../../../../packages/adapter-skaro/src/index.ts';

/** Creates an actual empty runtime workspace; all scenario files are produced by real tools. */
export async function startToolSession(mode: PermissionMode = 'full', readOnly = false) {
  const directory = await mkdtemp(join(tmpdir(), 'skaro-builtin-tools-'));
  const workspace = join(directory, 'workspace');
  await mkdir(workspace);
  const events: TimelineEvent[] = [];
  let owner: OwnedProcess;
  const options: SkaroSessionOptions = {
    config: {
      sessionId: 'tools-check',
      journalPath: join(directory, 'session.jsonl'),
      permissionMode: mode,
      versions: BUILTIN_CONTRACT_VERSIONS,
      route: {
        schema: 1,
        routeId: 'route',
        routeRevision: 1,
        connectionId: 'connection',
        connectionRevision: 1,
        connector: 'openai',
        endpoint: 'https://api.openai.com/v1',
        apiProfile: { id: 'openai.responses', revision: 1 },
        modelId: 'saved-model',
        parameters: {},
        upstream: DEFAULT_UPSTREAM_POLICY,
      },
      tools: { cwd: workspace, readDirs: [], readOnly, artifactDir: join(directory, 'artifacts') },
    },
    processStarted: (pid, identity) => {
      if (!identity) throw new Error('Runtime owner identity missing');
      owner = { pid, ...identity };
      appendFileSync(join(directory, 'owners.jsonl'), JSON.stringify(owner) + '\n');
    },
    raw: () => undefined,
  };
  let session = await SkaroSession.start(options);
  const observe = async (current: SkaroSession) => {
    for await (const event of current.events) events.push(event);
  };
  let drain = observe(session);
  return {
    get session() {
      return session;
    },
    directory,
    workspace,
    events,
    tool: (name: string, args: unknown, id?: string) =>
      session.invokeTool(name, args, id) as Promise<Record<string, unknown>>,
    restart: async (crash = false) => {
      if (crash) await stopOwnedProcess(owner!);
      await session.close();
      await drain;
      session = await SkaroSession.start(options);
      drain = observe(session);
      await session
        .send({ text: 'Explicitly resume lifecycle tool verification' })
        .catch((error: unknown) => {
          if (
            !(error instanceof Error) ||
            !error.message.includes('Model execution is not connected to host admission')
          )
            throw error;
        });
    },
    close: async () => {
      await session.close();
      await drain;
      await rm(directory, { recursive: true, force: true });
    },
  };
}
export type ToolSession = Awaited<ReturnType<typeof startToolSession>>;
