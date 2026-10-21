import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { app } from 'electron';
import {
  EventChannel,
  type AgentSession,
  type SessionOptions,
  type TimelineEvent,
} from '@skaro/timeline';
import { stopOwnedProcess, type OwnedProcess } from '../process-identity';
import type { NativeConfig, NativeOptions, Reply, Request, SessionMethod } from './protocol';

const workers = new Set<NativeSession>();
let closing = false;
/** Adapter calls retain their contract while native JSON, projections and raw encoding run off main. */
class NativeSession implements AgentSession {
  readonly events = new EventChannel<TimelineEvent>();
  private readonly worker: Worker;
  private readonly options: SessionOptions;
  private readonly processes: OwnedProcess[] = [];
  private readonly pending = new Map<number, { resolve(): void; reject(error: Error): void }>();
  private serial = 0;
  private error?: Error;
  private stopping?: Promise<void>;
  constructor(config: NativeConfig, options: SessionOptions) {
    this.options = options;
    this.worker = new Worker(join(app.getAppPath(), 'out', 'main', 'native-worker.js'), {
      workerData: config,
    });
    workers.add(this);
    this.worker.on('message', (reply: Reply) => this.receive(reply));
    this.worker.on('error', (error) => this.fail(error));
    this.worker.on('exit', (code) => {
      this.fail(new Error(`Native session worker exited (${code})`));
      workers.delete(this);
    });
  }
  private receive(reply: Reply): void {
    if (reply.type === 'spawn') {
      this.processes.push(reply.process);
      const gate = new Int32Array(reply.gate);
      try {
        if (this.stopping || closing) throw new Error('The application is closing');
        this.options.processStarted?.(reply.process.pid, reply.process);
        Atomics.store(gate, 0, 1);
      } catch (error) {
        Atomics.store(gate, 0, 2);
        this.fail(error instanceof Error ? error : new Error(String(error)));
      } finally {
        Atomics.notify(gate, 0);
      }
    } else if (reply.type === 'raw') {
      if (this.options.rawSerialized) this.options.rawSerialized(new Uint8Array(reply.bytes));
      else this.options.raw(JSON.parse(new TextDecoder().decode(reply.bytes)));
    } else if (reply.type === 'event') this.events.push(reply.event);
    else if (reply.type === 'ended') {
      if (reply.error) this.fail(new Error(reply.error));
      this.events.close();
      void this.close().catch((error: unknown) => console.error('Native cleanup:', error));
    } else {
      const pending = this.pending.get(reply.id);
      this.pending.delete(reply.id);
      if (reply.error) pending?.reject(new Error(reply.error));
      else pending?.resolve();
    }
  }
  private fail(error: Error): void {
    this.error ??= error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.events.close();
    if (!this.stopping)
      void this.close().catch((failure: unknown) => console.error('Native cleanup:', failure));
  }
  call(method: SessionMethod | 'start', args: unknown[] = []): Promise<void> {
    if (this.error) return Promise.reject(this.error);
    const id = ++this.serial;
    const request: Request = { id, method, args, secrets: this.options.secretValues?.() ?? [] };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(request);
    });
  }
  send: AgentSession['send'] = (input) => this.call('send', [input]);
  steer: AgentSession['steer'] = (input) => this.call('steer', [input]);
  respond: AgentSession['respond'] = (id, answer) => this.call('respond', [id, answer]);
  setModel: AgentSession['setModel'] = (model, effort) => this.call('setModel', [model, effort]);
  setPermissionMode: AgentSession['setPermissionMode'] = (mode) =>
    this.call('setPermissionMode', [mode]);
  rewind: AgentSession['rewind'] = (id) => this.call('rewind', [id]);
  compact = () => this.call('compact');
  interrupt = () => this.call('interrupt');
  stopBackground = (id: string) => this.call('stopBackground', [id]);
  close(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        // Stop descendants while their parent still has its verified OS identity.
        // Killing only the parent first can orphan MCP servers and background commands.
        void this.call('interrupt').catch(() => undefined);
        for (const process of this.processes) await stopOwnedProcess(process);
        await Promise.race([
          this.call('close').catch(() => undefined),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 5000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        await this.worker.terminate();
        this.events.close();
        workers.delete(this);
      }
    })();
    return this.stopping;
  }
}

export async function startNativeSession(
  config: NativeConfig,
  options: SessionOptions,
): Promise<AgentSession> {
  if (closing) throw new Error('The application is closing');
  options.signal?.throwIfAborted();
  const {
    raw: _raw,
    context: _context,
    processStarted: _process,
    rawSerialized: _encoded,
    secretValues: _secrets,
    signal,
    ...plain
  } = options;
  const session = new NativeSession(config, options);
  const abort = () => {
    void session.close().catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    await session.call('start', [plain satisfies NativeOptions]);
    signal?.throwIfAborted();
    return session;
  } catch (error) {
    await session.close();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
export async function closeNativeSessions(): Promise<void> {
  closing = true;
  await Promise.allSettled(
    [...workers].map((session) =>
      session.close().catch((error: unknown) => {
        console.error('Native shutdown:', error);
        throw error;
      }),
    ),
  );
}
