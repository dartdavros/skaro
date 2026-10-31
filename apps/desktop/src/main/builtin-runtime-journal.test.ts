import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { BUILTIN_CONTRACT_VERSIONS, DEFAULT_UPSTREAM_POLICY } from '@skaro/timeline';
import {
  RuntimeSession,
  SkaroProjector,
  restoreRuntime,
  type RuntimeStart,
} from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';

const directories: string[] = [];
const sessions: RuntimeSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

// Real production journals, commands and OS ownership. No seeded histories or API substitutes.
async function open(withSelection = false) {
  const directory = await mkdtemp(join(tmpdir(), 'skaro-runtime-journal-'));
  directories.push(directory);
  const config: RuntimeStart = {
    sessionId: 'journal-check',
    journalPath: join(directory, 'session.jsonl'),
    permissionMode: 'ask',
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
  };
  if (withSelection)
    config.availableRoutes = [
      config.route,
      {
        ...config.route,
        routeId: 'second-route',
        modelId: 'second-model',
      },
    ];
  const owner = {
    pid: process.pid,
    birth: (await processBirth(process.pid))!,
    platform: process.platform,
  };
  const session = await RuntimeSession.open(config, owner);
  sessions.push(session);
  return { session, config, owner };
}

it('durably deduplicates commands, rejects identity reuse and rebuilds state/feed from the same history', async () => {
  const { session, config, owner } = await open();
  const command = {
    id: 'input-1',
    action: { type: 'send' as const, input: { text: 'Lifecycle verification' } },
  };
  const first = await session.execute(command);
  expect(first.result.error).toContain('no model request was sent');
  expect(await session.execute(command)).toEqual(first);
  await expect(session.execute({ ...command, action: { type: 'interrupt' } })).rejects.toThrow(
    'identity reused',
  );
  await session.execute({ id: 'permissions', action: { type: 'setPermissionMode', mode: 'full' } });
  const inputId = session.journal.state.inputs[0]!.id;
  await session.execute({ id: 'rewind', action: { type: 'rewind', toItemId: inputId } });
  await session.execute({ id: 'stop', action: { type: 'interrupt' } });
  const before = structuredClone(session.journal.records);
  const state = structuredClone(session.journal.state);
  await Promise.all([session.dispose(), session.dispose()]);
  const resumed = await RuntimeSession.open(config, owner);
  sessions.push(resumed);
  expect(resumed.journal.records).toEqual(before);
  expect(resumed.journal.state).toEqual(state);
  expect(resumed.journal.state.stopped).toBe(true);
  expect(restoreRuntime(before)).toEqual(state);
  const project = (records: typeof before) => {
    const events: unknown[] = [];
    const projector = new SkaroProjector((event) => events.push(event));
    for (const record of records) projector.output(record);
    return events;
  };
  expect(project(resumed.journal.records)).toEqual(project(before));
  expect(project(before)).toContainEqual(
    expect.objectContaining({ t: 'turn.completed', outcome: 'failed' }),
  );
  expect(await resumed.execute(command)).toEqual(first);
  expect(resumed.journal.records).toHaveLength(before.length);
  const text = await readFile(config.journalPath, 'utf8');
  expect(text.endsWith('\n')).toBe(true);
  expect(text.split('\n').filter(Boolean)).toHaveLength(before.length);
}, 30_000);

it('rejects a second live owner and preserves explicit close on resume', async () => {
  const { session, config, owner } = await open();
  await expect(RuntimeSession.open(config, owner)).rejects.toThrow('live runtime owner');
  const record = await session.execute({ id: 'close', action: { type: 'close' } });
  expect(record.result.error).toBeUndefined();
  await session.dispose();
  const resumed = await RuntimeSession.open(config, owner);
  sessions.push(resumed);
  expect(resumed.journal.state.closed).toBe(true);
  expect(resumed.journal.state.stopped).toBe(true);
  expect(
    (await resumed.execute({ id: 'not-allowed', action: { type: 'compact' } })).result.error,
  ).toContain('closed');
}, 30_000);

it('recovers unresolved intents as unknown and keeps completed facts and open decisions', async () => {
  const { session, config, owner } = await open();
  // Journal/state contract check only: no tool executor or provider response is substituted.
  await session.journal.append('decision', [
    {
      type: 'interaction',
      interaction: {
        kind: 'question',
        id: 'owner-decision',
        questions: [
          {
            id: 'choice',
            header: 'Choice',
            text: 'Continue?',
            multi: false,
            allowFreeText: false,
            options: [{ label: 'Yes' }],
          },
        ],
      },
    },
  ]);
  await session.journal.append('intent', [
    { type: 'effect-intent', id: 'effect-1', name: 'pending-effect' },
  ]);
  const before = structuredClone(session.journal.records);
  await session.dispose();
  const resumed = await RuntimeSession.open(config, owner);
  sessions.push(resumed);
  expect(resumed.journal.state.effects['effect-1']?.state).toBe('unknown');
  expect(resumed.journal.state.interactions['owner-decision']).toBeDefined();
  expect(resumed.journal.records.slice(0, before.length)).toEqual(before);
  const blocked = await resumed.execute({
    id: 'blocked-input',
    action: { type: 'send', input: { text: 'Continue' } },
  });
  expect(blocked.result.error).toContain('prevents');
  const command = {
    id: 'answer',
    action: {
      type: 'respond' as const,
      interactionId: 'owner-decision',
      answer: { kind: 'question' as const, answers: { choice: ['Yes'] } },
    },
  };
  expect((await resumed.execute(command)).result.error).toBeUndefined();
  const count = resumed.journal.records.length;
  await resumed.execute(command);
  expect(resumed.journal.records).toHaveLength(count);
  expect(resumed.journal.state.interactions['owner-decision']).toBeUndefined();
  expect(resumed.journal.state.answered['owner-decision']).toEqual(command.action.answer);
}, 30_000);

it('switches only to an exact configured route and rejects tampered committed journal bytes', async () => {
  const { session, config, owner } = await open(true);
  await session.dispose();
  const route = { ...config.route, routeId: 'second-route', modelId: 'second-model' };
  // Host configuration is captured on creation; an existing session cannot silently adopt it.
  const invalid = await RuntimeSession.open(config, owner);
  sessions.push(invalid);
  expect(
    (
      await invalid.execute({
        id: 'unknown-model',
        action: { type: 'setModel', model: 'missing-route' },
      })
    ).result.error,
  ).toContain('Unknown');
  expect(
    (await invalid.execute({ id: 'route', action: { type: 'setModel', model: route.routeId } }))
      .result.error,
  ).toBeUndefined();
  expect(invalid.journal.state.config?.route).toEqual(route);
  expect(invalid.journal.state.continuation).toBeUndefined();
  await invalid.dispose();
  const text = await readFile(config.journalPath, 'utf8');
  const damaged = text.replace('saved-model', 'altered-model');
  await writeFile(config.journalPath, damaged);
  await expect(RuntimeSession.open({ ...config, route }, owner)).rejects.toThrow(
    'Invalid or incompatible',
  );
  expect(await readFile(config.journalPath, 'utf8')).toBe(damaged);
}, 30_000);
