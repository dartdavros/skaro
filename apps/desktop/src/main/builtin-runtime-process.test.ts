import { mkdtemp, readFile, rm, appendFile } from 'node:fs/promises';
import { appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { BUILTIN_CONTRACT_VERSIONS, DEFAULT_UPSTREAM_POLICY, type RawLine } from '@skaro/timeline';
import {
  SkaroSession,
  type SkaroSessionOptions,
} from '../../../../packages/adapter-skaro/src/index.ts';
import {
  processBirth,
  stopOwnedProcess,
  type OwnedProcess,
} from '@skaro/agent-runtime/process-identity';
import { runtimeEnvironment } from '../../../../packages/adapter-skaro/src/process-env.ts';

const directories: string[] = [];
const sessions: SkaroSession[] = [];
const owners: OwnedProcess[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
  for (const owner of owners.splice(0)) await stopOwnedProcess(owner);
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
}, 45_000);

async function options(): Promise<SkaroSessionOptions & { rawRecords: RawLine[] }> {
  const directory = await mkdtemp(join(tmpdir(), 'skaro-runtime-process-'));
  directories.push(directory);
  const rawRecords: RawLine[] = [];
  return {
    config: {
      sessionId: 'process-check',
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
    },
    rawRecords,
    raw: (record) => rawRecords.push(record),
    processStarted: (pid, identity) => {
      if (!identity) throw new Error('Missing owned identity');
      expect(existsSync(join(directory, 'session.jsonl'))).toBe(false);
      const owner = { pid, ...identity };
      owners.push(owner);
      appendFileSync(join(directory, 'ownership.jsonl'), JSON.stringify(owner) + '\n');
    },
  };
}

it('starts a genuine separate process after ownership admission, rejects model work and confirms shutdown', async () => {
  const config = await options();
  const session = await SkaroSession.start(config);
  sessions.push(session);
  expect(session.processId).not.toBe(process.pid);
  await expect(session.send({ text: 'Lifecycle check only' })).rejects.toThrow('not implemented');
  await expect(session.compact()).rejects.toThrow('Compaction requires');
  await session.setPermissionMode('full');
  await session.interrupt();
  await session.close();
  expect(await processBirth(session.processId)).toBeUndefined();
  const journal = await readFile(config.config.journalPath, 'utf8');
  expect(journal).toContain('"type":"closed"');
  expect(config.rawRecords.length).toBeGreaterThan(0);
}, 45_000);

it('cancels startup at admission without a late journal write or remaining runtime', async () => {
  const config = await options();
  const controller = new AbortController();
  const record = config.processStarted!;
  config.signal = controller.signal;
  config.processStarted = (pid, identity) => {
    record(pid, identity);
    controller.abort();
  };
  await expect(SkaroSession.start(config)).rejects.toThrow();
  expect(existsSync(config.config.journalPath)).toBe(false);
  expect(await processBirth(owners.at(-1)!.pid)).toBeUndefined();
}, 30_000);

it('recovers the real journal after an OS kill and truncates only an unacknowledged torn tail', async () => {
  const config = await options();
  const first = await SkaroSession.start(config);
  sessions.push(first);
  await first.interrupt();
  await stopOwnedProcess(owners.at(-1)!);
  await first.close();
  const before = await readFile(config.config.journalPath, 'utf8');
  await appendFile(config.config.journalPath, '{"schema":');
  config.processStarted = (pid, identity) => {
    owners.push({ pid, ...identity! });
  };
  const resumed = await SkaroSession.start(config);
  sessions.push(resumed);
  expect(await readFile(config.config.journalPath, 'utf8')).toBe(before);
  await resumed.close();
}, 45_000);

it('does not forward API credentials or host configuration to the runtime environment', () => {
  const env = runtimeEnvironment();
  expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
  expect(
    Object.keys(env).every((key) =>
      /^(PATH|SYSTEMROOT|WINDIR|PATHEXT|COMSPEC|TEMP|TMP|TMPDIR|LANG|LC_ALL|LC_CTYPE|ELECTRON_RUN_AS_NODE)$/i.test(
        key,
      ),
    ),
  ).toBe(true);
});

it('admits exactly one of two simultaneous genuine runtimes for the same session', async () => {
  const config = await options();
  config.processStarted = (pid, identity) => {
    owners.push({ pid, ...identity! });
  };
  const results = await Promise.allSettled([
    SkaroSession.start(config),
    SkaroSession.start(config),
  ]);
  for (const result of results) if (result.status === 'fulfilled') sessions.push(result.value);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(String(rejected?.reason)).toContain('live runtime owner');
  await sessions.at(-1)!.setPermissionMode('ask');
}, 45_000);
