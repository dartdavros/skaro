import { appendFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { RuntimeSession, connectMcpExtension, type RuntimeStart } from '@skaro/agent-runtime';
import { BUILTIN_CONTRACT_VERSIONS, DEFAULT_UPSTREAM_POLICY } from '@skaro/timeline';
import { processBirth, type OwnedProcess } from '@skaro/agent-runtime/process-identity';
import { taskBrowserServer } from './task-browser';

it.skipIf(process.platform !== 'win32')(
  'runs the genuine bundled Playwright MCP through the guarded runtime catalogue and confirms owned exit',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skaro-real-mcp-'));
    const controller = new AbortController();
    const owners: OwnedProcess[] = [];
    let session: RuntimeSession | undefined;
    const extension = await connectMcpExtension({
      id: 'playwright',
      config: await taskBrowserServer(directory, 'builtin-check'),
      cwd: resolve('.'),
      signal: controller.signal,
      allowed: [{ name: 'browser_tabs', readOnly: false }],
      processes: {
        admit: async (owner, signal) => {
          signal.throwIfAborted();
          expect(await processBirth(owner.pid)).toBe(owner.birth);
          appendFileSync(join(directory, 'owners.jsonl'), JSON.stringify(owner) + '\n');
          owners.push(owner);
        },
        exited: async (owner) => {
          expect(await processBirth(owner.pid)).not.toBe(owner.birth);
        },
      },
    });
    try {
      expect(extension.tools).toHaveLength(1);
      const tool = extension.tools[0]!;
      const config: RuntimeStart = {
        sessionId: 'mcp-check',
        journalPath: join(directory, 'session.jsonl'),
        permissionMode: 'ask',
        versions: BUILTIN_CONTRACT_VERSIONS,
        extensions: [{ name: tool.name, revision: tool.revision, readOnly: false }],
        route: {
          schema: 1,
          routeId: 'no-model',
          routeRevision: 1,
          connectionId: 'no-model',
          connectionRevision: 1,
          connector: 'openai',
          endpoint: 'https://api.openai.com/v1',
          apiProfile: { id: 'openai.responses', revision: 1 },
          modelId: 'not-requested',
          parameters: {},
          upstream: DEFAULT_UPSTREAM_POLICY,
        },
        tools: {
          cwd: resolve('.'),
          readDirs: [],
          readOnly: false,
          artifactDir: join(directory, 'artifacts'),
        },
      };
      session = await RuntimeSession.open(
        config,
        { pid: process.pid, birth: (await processBirth(process.pid))!, platform: process.platform },
        extension,
      );
      const unknown = await session.execute({
        id: 'outside',
        action: {
          type: 'tool',
          name: 'mcp__playwright__browser_navigate',
          args: { url: 'https://example.com' },
        },
      });
      expect(unknown.result.error).toContain('Unknown tool');
      const invalid = await session.execute({
        id: 'invalid',
        action: { type: 'tool', name: tool.name, args: { action: 42 } },
      });
      expect(invalid.result.error).toContain('Invalid extension');
      const pending = session.execute({
        id: 'list-tabs',
        action: { type: 'tool', name: tool.name, args: { action: 'list' } },
      });
      await expect
        .poll(() => session!.journal.state.interactions['approval-list-tabs'])
        .toBeDefined();
      expect(session.journal.state.effects['list-tabs']).toBeUndefined();
      await session.execute({
        id: 'approve-list',
        action: {
          type: 'respond',
          interactionId: 'approval-list-tabs',
          answer: { kind: 'approval', choice: 'allow_once' },
        },
      });
      const result = await pending;
      expect(result.result.error).toBeUndefined();
      expect(result.result.value).toHaveProperty('text');
      const count = session.journal.records.length;
      expect(
        await session.execute({
          id: 'list-tabs',
          action: { type: 'tool', name: tool.name, args: { action: 'list' } },
        }),
      ).toEqual(result);
      expect(session.journal.records).toHaveLength(count);
      await session.execute({ id: 'stop', action: { type: 'interrupt' } });
      for (const owner of owners) expect(await processBirth(owner.pid)).not.toBe(owner.birth);
      expect(owners).toHaveLength(1);
    } finally {
      controller.abort();
      await session?.dispose();
      await extension.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  90_000,
);
