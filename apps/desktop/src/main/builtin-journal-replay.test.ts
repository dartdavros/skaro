import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, appendFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  BUILTIN_CONTRACT_VERSIONS,
  DEFAULT_UPSTREAM_POLICY,
  replayRunLog,
  type BuiltinJournalReplayBoundary,
  type BuiltinSessionOptions,
  type RawLine,
  type TimelineEvent,
} from '@skaro/timeline';
import { readRuntimeJournal, SkaroProjector } from '@skaro/agent-runtime';
import {
  processBirth,
  stopOwnedProcess,
  type OwnedProcess,
} from '@skaro/agent-runtime/process-identity';
import { SkaroSession } from '../../../../packages/adapter-skaro/src/session';
import { SessionProjection } from '../../../../packages/adapter-skaro/src/projection';
import { skaroDefinition } from '../../../../packages/adapter-skaro/src/definition';
import { builtinJournalReplay } from './builtin-journal-replay';
import { builtinSessionDirectory } from './builtin-session-directory';
import { replayHistory } from './background/history-replay';

it('resumes genuine processes without redelivering copied inputs/terminals and rebuilds the same multi-segment feed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'skaro-journal-replay-'));
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('skaro-journal-replay-')
  )
    throw new Error('Unexpected primary replay verification directory');
  const owners: OwnedProcess[] = [];
  const sessions: SkaroSession[] = [];
  const options: BuiltinSessionOptions = {
    config: {
      sessionId: 'real-replay',
      journalPath: join(directory, 'primary.jsonl'),
      permissionMode: 'ask',
      versions: BUILTIN_CONTRACT_VERSIONS,
      route: {
        schema: 1,
        routeId: 'not-connected',
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
    },
    processStarted(pid, identity) {
      if (!identity) throw new Error('Missing genuine OS owner');
      owners.push({ pid, ...identity });
    },
    raw: () => {
      throw new Error('Raw sink must be bound to this actual generation');
    },
  };
  const start = async (journalReplay?: BuiltinJournalReplayBoundary) => {
    const raw: RawLine[] = [],
      events: TimelineEvent[] = [];
    const session = await SkaroSession.start({
      ...options,
      journalReplay,
      raw: (line) => raw.push(line),
    });
    sessions.push(session);
    const drain = (async () => {
      for await (const event of session.events) events.push(event);
    })();
    return {
      raw,
      events,
      session,
      close: async () => {
        await session.close();
        await drain;
      },
    };
  };
  const meta: RawLine = {
    ts: 0,
    dir: 'meta',
    line: { skaro: 'segment', agent: 'skaro', adapterVersion: skaroDefinition.adapterVersion },
  };
  const attachImage = () => {
    throw new Error('No image input is admitted');
  };
  try {
    const first = await start();
    await expect(
      first.session.send({ text: 'First real input, without a model host' }, 'first'),
    ).rejects.toThrow('no model request was sent');
    await first.close();
    const path = join(directory, 'host.jsonl');
    const writer = createWriteStream(path);
    writer.write([meta, ...first.raw].map((line) => JSON.stringify(line)).join('\n') + '\n');
    const copied = await builtinJournalReplay(path, options.config.sessionId, writer);
    writer.end();
    await finished(writer);
    expect(copied.needsSeparator).toBe(false);
    const original = await readRuntimeJournal(options.config.journalPath, options.config.sessionId);
    expect(copied.boundary.sequence).toBe(original.records.length);
    expect(copied.boundary.hash).toBe(original.records.at(-1)!.hash);
    const second = await start(copied.boundary);
    expect(second.raw).toEqual([]);
    expect(second.events).toEqual([]);
    await expect(
      second.session.send({ text: 'First real input, without a model host' }, 'first'),
    ).rejects.toThrow('no model request was sent');
    expect(second.raw).toEqual([]);
    await expect(
      second.session.send({ text: 'Second real input, without a model host' }, 'second'),
    ).rejects.toThrow('no model request was sent');
    await second.close();
    const lines = [meta, ...first.raw, meta, ...second.raw];
    await appendFile(
      path,
      [meta, ...second.raw].map((line) => JSON.stringify(line)).join('\n') + '\n',
    );
    const expected = [...first.events, ...second.events];
    const replayed = replayRunLog(
      lines,
      0,
      (_context, emit) => new SkaroProjector(emit),
      attachImage,
    );
    expect(replayed).toEqual(expected);
    const background: TimelineEvent[] = [];
    expect(
      await replayHistory(path, 0, 'skaro', { attachImage }, (event) => background.push(event)),
    ).toBe(2);
    expect(background).toEqual(expected);
    expect(expected.filter((event) => event.t === 'turn.completed')).toHaveLength(2);
    const current = await readRuntimeJournal(options.config.journalPath, options.config.sessionId);
    const all = current.records;
    const raw = all.map((line): RawLine => ({ ts: line.timestamp, dir: 'out', line }));
    const damaged = join(directory, 'copied-torn-tail.jsonl');
    const partial = JSON.stringify(raw.at(-1)).slice(0, 40);
    const prefix =
      [meta, ...raw.slice(0, -1)].map((line) => JSON.stringify(line)).join('\n') + '\n' + partial;
    await writeFile(damaged, prefix);
    const recovery = await builtinJournalReplay(damaged, options.config.sessionId);
    expect(recovery.needsSeparator).toBe(true);
    expect(recovery.boundary.sequence).toBe(all.length - 1);
    const recovered: RawLine[] = [];
    const projection = new SessionProjection(
      { ...options, journalReplay: recovery.boundary, raw: (line) => recovered.push(line) },
      () => {},
    );
    projection.ready(all);
    expect(recovered).toEqual(raw.slice(-1));
    await appendFile(
      damaged,
      '\n' + recovered.map((line) => JSON.stringify(line)).join('\n') + '\n',
    );
    expect((await readFile(damaged, 'utf8')).startsWith(prefix)).toBe(true);
    expect((await builtinJournalReplay(damaged, options.config.sessionId)).boundary.sequence).toBe(
      all.length,
    );
    const rejected = new SessionProjection(
      { ...options, journalReplay: { ...recovery.boundary, hash: '0'.repeat(64) } },
      () => {},
    );
    expect(() => rejected.ready(all)).toThrow('differs from the primary journal');
    await expect(start({ ...copied.boundary, hash: '0'.repeat(64) })).rejects.toThrow(
      'replay boundary',
    );
    for (const owner of owners) expect(await processBirth(owner.pid)).toBeUndefined();
    const missing = await builtinJournalReplay(
      join(directory, 'absent.jsonl'),
      options.config.sessionId,
    );
    expect(missing.boundary.sequence).toBe(0);
    const currentDir = builtinSessionDirectory(
      directory,
      'tasks',
      'actual-owner',
      options.config.sessionId,
    );
    expect(builtinSessionDirectory(directory, 'tasks', 'actual-owner', 'cleared-history')).not.toBe(
      currentDir,
    );
    expect(dirname(currentDir)).toBe(join(directory, 'builtin', 'tasks', 'actual-owner'));
  } finally {
    for (const session of sessions) await session.close();
    for (const owner of owners) await stopOwnedProcess(owner);
    await rm(directory, { recursive: true, force: true });
  }
}, 90_000);
