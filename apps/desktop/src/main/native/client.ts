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
import { RuntimeHostServer, requireModelBaseline } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import { requireNativeSessionHost, type NativeSessionHost } from './host-binding';

const workers = new Set<NativeSession>();
let closing = false;
/** Adapter calls retain their contract while native JSON, projections and raw encoding run off main. */
class NativeSession implements AgentSession {
  readonly events = new EventChannel<TimelineEvent>();
  private readonly worker: Worker;
  private readonly options: SessionOptions;
  private readonly processes: OwnedProcess[] = [];
  private readonly pending = new Map<
    number,
    { resolve(value?: unknown): void; reject(error: Error): void }
  >();
  private serial = 0;
  private error?: Error;
  private stopping?: Promise<void>;
  private readonly bundled: boolean;
  private readonly hosts: RuntimeHostServer;
  private readonly hostSignal?: AbortSignal;
  private readonly revoke = () => {
    void this.close().catch((error: unknown) => console.error('Native admission cleanup:', error));
  };
  constructor(
    config: NativeConfig,
    options: SessionOptions,
    host: NativeSessionHost = {},
    workerEntry = join(app.getAppPath(), 'out', 'main', 'native-worker.js'),
  ) {
    requireNativeSessionHost(config, host);
    this.hostSignal = host.signal;
    this.bundled = 'bundled' in config;
    this.options = options;
    this.hosts = new RuntimeHostServer(
      host,
      (reply) => this.worker.postMessage(reply),
      (signal) => this.requireOwner(signal),
    );
    this.worker = new Worker(workerEntry, { workerData: config });
    workers.add(this);
    this.worker.on('message', (reply: Reply) => {
      try {
        this.receive(reply);
      } catch {
        this.fail(new Error('Invalid native host request'));
      }
    });
    this.worker.on('error', (error) => this.fail(error));
    this.worker.on('exit', (code) => {
      this.fail(new Error(`Native session worker exited (${code})`));
      workers.delete(this);
    });
    this.hostSignal?.addEventListener('abort', this.revoke, { once: true });
    if (this.hostSignal?.aborted) this.revoke();
  }
  private async requireOwner(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.hostSignal?.throwIfAborted();
    const owner = this.processes[0];
    if (
      this.stopping ||
      closing ||
      this.error ||
      !owner ||
      (await processBirth(owner.pid)) !== owner.birth
    )
      throw new Error('Native host owner is not active');
    signal.throwIfAborted();
    this.hostSignal?.throwIfAborted();
  }
  private receive(reply: Reply): void {
    if (
      reply.type === 'runtime-rpc-call' ||
      reply.type === 'runtime-rpc-cancel' ||
      reply.type === 'verification-inspect' ||
      reply.type === 'verification-cancel' ||
      reply.type === 'model-rpc-call' ||
      reply.type === 'model-rpc-cancel'
    ) {
      this.hosts.receive(reply);
    } else if (reply.type === 'spawn') {
      this.processes.push(reply.process);
      const gate = new Int32Array(reply.gate);
      try {
        if (this.stopping || closing || this.hostSignal?.aborted)
          throw new Error('Native host admission is closed');
        this.options.processStarted?.(reply.process.pid, reply.process);
        if (this.stopping || closing || this.hostSignal?.aborted)
          throw new Error('Native host admission was revoked while recording ownership');
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
      else pending?.resolve(reply.value);
    }
  }
  private fail(error: Error): void {
    void this.hosts.close().catch(() => undefined);
    this.error ??= error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.events.close();
    if (!this.stopping)
      void this.close().catch((failure: unknown) => console.error('Native cleanup:', failure));
  }
  call<T = void>(method: SessionMethod | 'start', args: unknown[] = []): Promise<T> {
    if (method !== 'close' && method !== 'interrupt' && (this.stopping || this.hostSignal?.aborted))
      return Promise.reject(new Error('Native host admission is closed'));
    if (this.error) return Promise.reject(this.error);
    const id = ++this.serial;
    const request: Request = { id, method, args, secrets: this.options.secretValues?.() ?? [] };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.worker.postMessage(request);
    });
  }
  send: AgentSession['send'] = (input) => this.call('send', [input]);
  deliverInput(input: import('@skaro/timeline').UserInput, id: string, mode = 'send') {
    return this.call('deliverInput', [input, id, mode]);
  }
  invokeTool(name: string, args: unknown, id?: string): Promise<unknown> {
    return this.call<unknown>('invokeTool', [name, args, id]);
  }
  runModelTurn(request: import('@skaro/timeline').RuntimeModelRequest, id: string, maxSteps = 20) {
    return this.call<unknown>('runModelTurn', [request, id, maxSteps]);
  }
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
    const extensionsClosed = this.hosts.close();
    void extensionsClosed?.catch(() => undefined);
    this.stopping = (async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        if (this.bundled) {
          await Promise.race([
            this.call('close').catch(() => undefined),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, 30_000);
            }),
          ]);
          clearTimeout(timer);
        }
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
        this.hostSignal?.removeEventListener('abort', this.revoke);
        clearTimeout(timer);
        await this.worker.terminate();
        this.events.close();
        workers.delete(this);
        await extensionsClosed;
      }
    })();
    return this.stopping;
  }
}

export async function startNativeSession(
  config: NativeConfig,
  options: SessionOptions,
  host?: NativeSessionHost,
  workerEntry?: string,
): Promise<AgentSession> {
  if (closing) throw new Error('The application is closing');
  options.signal?.throwIfAborted();
  await requireModelBaseline(host?.model);
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
  const session = new NativeSession(config, options, host, workerEntry);
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
