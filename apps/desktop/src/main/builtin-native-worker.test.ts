import { Worker } from 'node:worker_threads';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  BUILTIN_CONTRACT_VERSIONS,
  DEFAULT_UPSTREAM_POLICY,
  operationTimeout,
  type BuiltinSessionStart,
  type TimelineEvent,
} from '@skaro/timeline';
import { SkaroProjector } from '@skaro/agent-runtime';
import {
  processBirth,
  stopOwnedProcess,
  type OwnedProcess,
} from '@skaro/agent-runtime/process-identity';
import type { Reply, Request, SessionMethod } from './native/protocol';

for (const admit of [true, false]) {
  it(`uses the compiled native worker and ${admit ? 'admits' : 'rejects'} the genuine runtime process`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skaro-native-builtin-'));
    const config: BuiltinSessionStart = {
      sessionId: 'native-check',
      journalPath: join(directory, 'session.jsonl'),
      permissionMode: 'ask',
      versions: BUILTIN_CONTRACT_VERSIONS,
      tools: {
        cwd: directory,
        readDirs: [],
        readOnly: true,
        artifactDir: join(directory, 'artifacts'),
      },
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
    const worker = new Worker(resolve('apps/desktop/out/main/native-worker.js'), {
      workerData: {
        agent: 'skaro',
        bundled: config,
        attachmentsDir: join(directory, 'attachments'),
        entry: resolve('apps/desktop/out/main/agent-runtime-worker.js'),
      },
    });
    const owners: OwnedProcess[] = [];
    const events: TimelineEvent[] = [];
    const pending = new Map<
      number,
      { resolve(value?: unknown): void; reject(error: Error): void }
    >();
    let serial = 0;
    worker.on('message', (reply: Reply) => {
      if (reply.type === 'spawn') {
        owners.push(reply.process);
        appendFileSync(join(directory, 'owners.jsonl'), JSON.stringify(reply.process) + '\n');
        const gate = new Int32Array(reply.gate);
        Atomics.store(gate, 0, admit ? 1 : 2);
        Atomics.notify(gate, 0);
      } else if (reply.type === 'event') events.push(reply.event);
      else if (reply.type === 'reply') {
        const target = pending.get(reply.id);
        pending.delete(reply.id);
        if (reply.error) target?.reject(new Error(reply.error));
        else target?.resolve(reply.value);
      }
    });
    worker.on('error', (error) => {
      for (const target of pending.values()) target.reject(error);
      pending.clear();
    });
    const call = <T = void>(method: SessionMethod | 'start', args: unknown[] = []): Promise<T> => {
      const id = ++serial;
      return operationTimeout(
        new Promise<T>((resolve, reject) => {
          pending.set(id, { resolve: (value) => resolve(value as T), reject });
          worker.postMessage({ id, method, args, secrets: [] } satisfies Request);
        }),
        20_000,
        'Native worker reply timed out',
      );
    };
    try {
      const startup = call('start', [{ cwd: directory, permissionMode: 'ask' }]);
      if (!admit) {
        await expect(startup).rejects.toThrow('admission was rejected');
        expect(existsSync(config.journalPath)).toBe(false);
      } else {
        await startup;
        for (const mode of ['send', 'steer'] as const) {
          const args = [{ text: 'Native lifecycle verification' }, `native-${mode}`];
          await expect(call(mode, args)).rejects.toThrow('no model request was sent');
          const acknowledged = await readFile(config.journalPath, 'utf8');
          await expect(call(mode, args)).rejects.toThrow('no model request was sent');
          expect(await readFile(config.journalPath, 'utf8')).toBe(acknowledged);
          expect(acknowledged).toContain(`"id":"cmd:native-${mode}"`);
        }
        const file = await call<Record<string, unknown>>('invokeTool', [
          'read_file',
          { path: 'owners.jsonl' },
          'native-read',
        ]);
        expect(String(file.text)).toContain(String(owners[0]!.pid));
        await call('interrupt');
        await call('close');
        const records = (await readFile(config.journalPath, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        const projected: TimelineEvent[] = [];
        expect(
          records[0].facts.find((fact: { type: string }) => fact.type === 'created').runtimeVersion,
        ).toMatch(/^\d+\.\d+\.\d+$/);
        const projector = new SkaroProjector((event) => projected.push(event));
        for (const record of records) projector.output(record);
        expect(events).toEqual(projected);
      }
      expect(owners).toHaveLength(1);
      expect(await processBirth(owners[0]!.pid)).toBeUndefined();
    } finally {
      for (const owner of owners) await stopOwnedProcess(owner);
      await worker.terminate();
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
}
