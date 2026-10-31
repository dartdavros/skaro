import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import {
  RuntimeSession,
  latestContext,
  contextChatRequest,
  type RuntimeStart,
} from '@skaro/agent-runtime';
import { BUILTIN_CONTRACT_VERSIONS, DEFAULT_UPSTREAM_POLICY } from '@skaro/timeline';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import {
  collectContext,
  contextPage,
} from '../../../../packages/agent-runtime/src/context/sources';
import { PathScope } from '../../../../packages/agent-runtime/src/tools/path-scope';

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'skaro-real-context-'));
  const config: RuntimeStart = {
    sessionId: 'context-check',
    journalPath: join(directory, 'journal.jsonl'),
    permissionMode: 'ask',
    versions: BUILTIN_CONTRACT_VERSIONS,
    route: {
      schema: 1,
      routeId: 'read-only',
      routeRevision: 1,
      connectionId: 'not-connected',
      connectionRevision: 1,
      connector: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1',
      apiProfile: { id: 'openrouter.chat-completions', revision: 1 },
      modelId: 'not-requested',
      parameters: {},
      upstream: DEFAULT_UPSTREAM_POLICY,
    },
    tools: {
      cwd: resolve('.'),
      readDirs: [],
      readOnly: true,
      artifactDir: join(directory, 'artifacts'),
    },
    context: {
      scopePath: 'apps/desktop',
      pins: [],
      documents: [
        { id: 'plan', path: 'docs/builtin-agent-plan.md', kind: 'task' },
        { id: 'architecture', path: 'docs/adr/0047-builtin-agent.md', kind: 'adr' },
      ],
    },
  };
  const owner = {
    pid: process.pid,
    birth: (await processBirth(process.pid))!,
    platform: process.platform,
  };
  let session = await RuntimeSession.open(config, owner);
  return {
    config,
    directory,
    get session() {
      return session;
    },
    reopen: async () => {
      await session.dispose();
      session = await RuntimeSession.open(config, owner);
    },
    close: async () => {
      await session.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

it('collects actual scoped instructions/documents and compacts without deleting journal or editing native items', async () => {
  const live = await setup();
  try {
    const refreshed = await live.session.execute({
      id: 'refresh',
      action: { type: 'refreshContext' },
    });
    expect(refreshed.result.error).toBeUndefined();
    const snapshot = latestContext(live.session.journal)!;
    expect(
      snapshot.snapshot.sources
        .filter((source) => source.kind === 'scope-instructions')
        .map((source) => source.path),
    ).toEqual(['AGENTS.md', 'apps/desktop/AGENTS.md']);
    expect(snapshot.snapshot.sources[0]!.exactText).toBe(await readFile('AGENTS.md', 'utf8'));
    const page = await live.session.execute({
      id: 'page',
      action: { type: 'tool', name: 'context_read', args: { id: 'architecture', limit: 64 } },
    });
    expect(page.result.error).toBeUndefined();
    expect(page.result.value).toMatchObject({
      text: (await readFile('docs/adr/0047-builtin-agent.md', 'utf8')).slice(0, 64),
      nextCursor: 64,
    });
    await live.session.execute({
      id: 'input',
      action: {
        type: 'send',
        input: { text: 'Продолжай код прямых коннекторов; живые проверки позже' },
      },
    });
    const before = structuredClone(live.session.journal.records);
    const compacted = await live.session.execute({ id: 'compact', action: { type: 'compact' } });
    expect(compacted.result.error).toBeUndefined();
    expect(live.session.journal.records.slice(0, before.length)).toEqual(before);
    expect(latestContext(live.session.journal)!.epoch).toBe(1);
    expect(live.session.journal.state.continuation!.value).toMatchObject({
      kind: 'context-boundary',
      epoch: 1,
    });
    const request = contextChatRequest(live.session, {
      route: live.config.route,
      price: { prompt: 0.5, completion: 2 },
      messages: [{ role: 'user', content: 'Continue the authorized task.' }],
    });
    expect(request.messages[0]!.content).toContain('живые проверки позже');
    expect(request.messages[0]!.content).toContain('Без явного указания владельца');
    const old = snapshot.snapshot.revision;
    await expect(
      live.session.context!.requireCurrent(old, 0, new AbortController().signal),
    ).rejects.toThrow('stale');
    await live.reopen();
    expect(latestContext(live.session.journal)!.epoch).toBe(1);
    const count = live.session.journal.records.length;
    await live.session.execute({ id: 'compact', action: { type: 'compact' } });
    expect(live.session.journal.records).toHaveLength(count);
    const head = latestContext(live.session.journal)!.history;
    const history = await live.session.execute({
      id: 'history',
      action: {
        type: 'tool',
        name: 'context_history',
        args: { sequence: head.throughSequence, hash: head.headHash, limit: 128 },
      },
    });
    expect(history.result.error).toBeUndefined();
    expect(history.result.value).toMatchObject({ hash: head.headHash, nextCursor: 128 });
  } finally {
    await live.close();
  }
}, 30_000);

it('keeps a genuine owner question open across failed compact and preserves its exact answer after compact/restart', async () => {
  const live = await setup();
  try {
    const work = live.session.execute({
      id: 'question',
      action: {
        type: 'tool',
        name: 'ask_user',
        args: {
          questions: [
            {
              id: 'live-checks',
              header: 'BYOK',
              text: 'Когда проверять прямые API?',
              multi: false,
              allowFreeText: true,
              options: [],
            },
          ],
        },
      },
    });
    while (!live.session.journal.state.interactions['question-question'])
      await new Promise((resolve) => setTimeout(resolve, 10));
    const blocked = await live.session.execute({
      id: 'blocked-compact',
      action: { type: 'compact' },
    });
    expect(blocked.result.error).toContain('Open interactions');
    await live.session.execute({
      id: 'answer',
      action: {
        type: 'respond',
        interactionId: 'question-question',
        answer: { kind: 'question', answers: { 'live-checks': ['Живые проверки позже'] } },
      },
    });
    await work;
    const compacted = await live.session.execute({
      id: 'after-answer',
      action: { type: 'compact' },
    });
    expect(compacted.result.error).toBeUndefined();
    await live.reopen();
    const request = contextChatRequest(live.session, {
      route: live.config.route,
      price: { prompt: 0.5, completion: 2 },
      messages: [{ role: 'user', content: 'Continue.' }],
    });
    expect(request.messages[0]!.content).toContain('Живые проверки позже');
    expect(request.messages[0]!.content).toContain('Когда проверять прямые API?');
    expect(() =>
      contextChatRequest(live.session, {
        ...request,
        messages: [{ role: 'assistant', content: 'Closed native history' }],
      }),
    ).toThrow('fresh user input');
  } finally {
    await live.close();
  }
}, 30_000);

it('rejects stale source revisions against a real repository document', async () => {
  const scope = await PathScope.create(resolve('.'), [], []);
  const signal = new AbortController().signal;
  const snapshot = await collectContext(
    scope,
    {
      scopePath: '.',
      pins: [],
      documents: [{ id: 'plan', kind: 'document', path: 'docs/builtin-agent-plan.md' }],
    },
    signal,
  );
  const current = await contextPage(scope, snapshot, 'plan', 0, 40, signal);
  expect(current.text).toBe((await readFile('docs/builtin-agent-plan.md', 'utf8')).slice(0, 40));
  snapshot.sources.find((source) => source.id === 'plan')!.revision = '0'.repeat(64);
  await expect(contextPage(scope, snapshot, 'plan', 0, 40, signal)).rejects.toThrow(
    'changed; refresh required',
  );
});
