import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  EventChannel,
  operationTimeout,
  type AgentSession,
  type BuiltinSessionOptions,
  type TimelineEvent,
} from '@skaro/timeline';
import {
  SkaroProjector,
  type JournalRecord,
  type RuntimeAction,
  type RuntimeCommand,
  type RuntimeMessage,
  type RuntimeStart,
  RuntimeHostServer,
  extensionBinding,
  requireExtensionBinding,
  modelBinding,
  requireModelBinding,
  requireModelBaseline,
  requireSameHostScope,
} from '@skaro/agent-runtime';
import {
  processBirth,
  stopOwnedProcess,
  type OwnedProcess,
} from '@skaro/agent-runtime/process-identity';
import { runtimeEnvironment } from './process-env.ts';

export type SkaroSessionOptions = BuiltinSessionOptions;

/** Real child process transport. It offers lifecycle, never fabricated model output. */
export class SkaroSession implements AgentSession {
  readonly events = new EventChannel<TimelineEvent>();
  readonly processId: number;
  private readonly child: ChildProcess;
  private readonly options: SkaroSessionOptions;
  private readonly projector: SkaroProjector;
  private readonly pending = new Map<
    string,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private readonly exited: Promise<void>;
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private owner?: OwnedProcess;
  private stopping?: Promise<void>;
  private failed?: Error;
  private readonly hosts: RuntimeHostServer;

  private constructor(options: SkaroSessionOptions) {
    this.options = options;
    this.projector = new SkaroProjector((event) => this.events.push(event));
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Startup can be cancelled before the admission probe finishes.
    void this.ready.catch(() => undefined);
    this.hosts = new RuntimeHostServer(
      options,
      (reply) => this.post(reply),
      (signal) => this.requireOwner(signal),
    );
    this.child = fork(
      options.entry ?? fileURLToPath(new URL('../../agent-runtime/src/worker.ts', import.meta.url)),
      [],
      {
        execArgv: [],
        env: runtimeEnvironment(),
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      },
    );
    this.processId = this.child.pid ?? 0;
    this.exited = new Promise((resolve) =>
      this.child.once('close', () => {
        this.fail(new Error('Skaro runtime exited'));
        this.events.close();
        resolve();
      }),
    );
    this.child.on('error', (error) => this.fail(error));
    this.child.on('message', (message: RuntimeMessage) => {
      try {
        this.receive(message);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error('Invalid runtime response'));
        void this.close().catch(() => undefined);
      }
    });
  }

  static async start(options: SkaroSessionOptions): Promise<SkaroSession> {
    options.signal?.throwIfAborted();
    options.extensions?.signal?.throwIfAborted();
    requireExtensionBinding(
      options.config,
      options.extensions && extensionBinding(options.extensions),
    );
    requireSameHostScope(options);
    requireModelBinding(options.config, options.model);
    await requireModelBaseline(options.model);
    options.signal?.throwIfAborted();
    if (!options.processStarted) throw new Error('Durable process ownership callback is required');
    const session = new SkaroSession(options);
    const abort = () => {
      void session.close().catch(() => undefined);
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      const birth = await processBirth(session.processId);
      if (!birth) throw new Error('Skaro runtime exited before ownership admission');
      session.owner = { pid: session.processId, birth, platform: process.platform };
      options.signal?.throwIfAborted();
      if (session.stopping) throw new Error('Runtime startup was cancelled');
      options.processStarted(session.processId, session.owner);
      options.signal?.throwIfAborted();
      if (session.stopping) throw new Error('Runtime startup was cancelled');
      session.post({
        type: 'start',
        config: options.config,
        owner: session.owner,
        extensions: options.extensions && extensionBinding(options.extensions),
        model: options.model && modelBinding(options.model),
        verification: options.verification && {
          scope: structuredClone(options.verification.scope),
          admission: structuredClone(options.verification.admission),
        },
      });
      await operationTimeout(session.ready, 15_000, 'Skaro runtime startup timed out');
      options.signal?.throwIfAborted();
      return session;
    } catch (error) {
      await session.close();
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', abort);
    }
  }

  private record(record: JournalRecord): void {
    this.options.raw({ ts: record.timestamp, dir: 'out', line: record });
    this.projector.output(record);
  }
  private async requireOwner(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (
      this.stopping ||
      this.failed ||
      !this.owner ||
      (await processBirth(this.owner.pid)) !== this.owner.birth
    )
      throw new Error('Runtime host owner is not active');
    signal.throwIfAborted();
  }

  private receive(message: RuntimeMessage): void {
    if (
      message.type === 'runtime-rpc-call' ||
      message.type === 'runtime-rpc-cancel' ||
      message.type === 'verification-inspect' ||
      message.type === 'verification-cancel' ||
      message.type === 'model-rpc-call' ||
      message.type === 'model-rpc-cancel'
    ) {
      this.hosts.receive(message);
    } else if (message.type === 'ready') {
      for (const record of message.records) this.record(record);
      this.resolveReady();
    } else if (message.type === 'record') this.record(message.record);
    else if (message.type === 'fatal') {
      this.fail(new Error(message.error));
      void this.close().catch(() => undefined);
    } else {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.result.error) pending?.reject(new Error(message.result.error));
      else pending?.resolve(message.result.value);
    }
  }

  private fail(error: Error): void {
    void this.hosts.close().catch(() => undefined);
    this.failed ??= error;
    this.rejectReady(error);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private post(message: unknown): void {
    this.child.send(message as object, (error) => {
      if (error) this.fail(error);
    });
  }

  /** Stable caller-supplied command IDs support redelivery after lost acknowledgements. */
  request(command: RuntimeCommand, timeoutMs = 15_000): Promise<unknown> {
    if (this.failed) return Promise.reject(this.failed);
    if (this.stopping && command.action.type !== 'close')
      return Promise.reject(new Error('Runtime is closing'));
    if (this.pending.has(command.id))
      return Promise.reject(new Error('Command delivery already pending'));
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(command.id, { resolve, reject });
      this.post({ type: 'command', command });
    });
    return (
      timeoutMs
        ? operationTimeout(response, timeoutMs, 'Runtime acknowledgement timed out')
        : response
    ).catch((error: unknown) => {
      this.pending.delete(command.id);
      throw error;
    });
  }

  private call(action: RuntimeAction): Promise<void> {
    if (this.stopping) return Promise.reject(new Error('Runtime is closing'));
    return this.request({ id: randomUUID(), action }).then(() => undefined);
  }
  invokeTool(name: string, args: unknown, id: string = randomUUID()): Promise<unknown> {
    return this.request({ id, action: { type: 'tool', name, args } }, 0);
  }
  runModelTurn(
    request: import('@skaro/timeline').RuntimeModelRequest,
    id: string = randomUUID(),
    maxSteps = 20,
  ) {
    return this.request({ id, action: { type: 'modelTurn', request, maxSteps } }, 0);
  }
  deliverInput(
    input: import('@skaro/timeline').UserInput,
    id: string = randomUUID(),
    mode: 'send' | 'steer' = 'send',
  ): Promise<void> {
    return this.request({ id, action: { type: mode, input } }).then(() => undefined);
  }
  send: AgentSession['send'] = (input) => this.deliverInput(input);
  steer: AgentSession['steer'] = (input) => this.deliverInput(input, randomUUID(), 'steer');
  respond: AgentSession['respond'] = (interactionId, answer) =>
    this.call({ type: 'respond', interactionId, answer });
  setModel: AgentSession['setModel'] = (model, effort) =>
    this.call({ type: 'setModel', model, effort });
  setRoute = (route: RuntimeStart['route']) => this.call({ type: 'setRoute', route });
  setPermissionMode: AgentSession['setPermissionMode'] = (mode) =>
    this.call({ type: 'setPermissionMode', mode });
  rewind: AgentSession['rewind'] = (toItemId) => this.call({ type: 'rewind', toItemId });
  compact = () => this.call({ type: 'compact' });
  interrupt = () => this.call({ type: 'interrupt' });
  stopBackground = (taskId: string) => this.call({ type: 'stopBackground', taskId });

  close(): Promise<void> {
    this.stopping ??= this.shutdown();
    return this.stopping;
  }
  private async shutdown(): Promise<void> {
    const extensionsClosed = this.hosts.close();
    void extensionsClosed?.catch(() => undefined);
    try {
      if (this.owner && !this.failed && this.child.connected) {
        await operationTimeout(this.ready, 1000, 'Startup still pending');
        await operationTimeout(
          this.request({ id: randomUUID(), action: { type: 'close' } }),
          3000,
          'Shutdown timed out',
        );
        await operationTimeout(this.exited, 3000, 'Runtime did not exit');
      }
    } catch {
      /* The verified OS owner below is the bounded shutdown fallback. */
    } finally {
      if (this.owner) await stopOwnedProcess(this.owner);
      else this.child.kill(); // Never admitted; no descendants or effects were allowed.
      await operationTimeout(this.exited, 5000, 'Runtime exit not confirmed');
      this.events.close();
      await extensionsClosed;
    }
  }
}
