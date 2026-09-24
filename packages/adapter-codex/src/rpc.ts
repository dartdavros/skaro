// JSON-RPC client for `codex app-server` over stdio (agent-output.md 1.2).
// The wire format has no "jsonrpc" field; one JSON message per line.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { delimiter } from 'node:path';

export interface CodexBinary {
  binary: string;
  /** Prepended to PATH (bundled rg and helpers). */
  pathDirs: string[];
}

export interface AppServerOptions extends CodexBinary {
  cwd?: string;
  /** `-c key=value` config overrides. */
  config?: string[];
  /** Replaces ~/.codex (tests, "not logged in" checks). */
  codexHome?: string;
  /** Every line both ways, before parsing. */
  onRaw?: (dir: 'in' | 'out' | 'err', line: unknown) => void;
  /** Messages from the server (after onRaw). */
  onMessage?: (msg: Record<string, unknown>) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

/** Notifications Skaro does not need (agent-output.md 1.2). */
export const OPT_OUT_NOTIFICATIONS = [
  'thread/realtime/started',
  'thread/realtime/itemAdded',
  'thread/realtime/item/started',
  'thread/realtime/item/transcript/delta',
  'thread/realtime/item/completed',
  'thread/realtime/transcript/delta',
  'thread/realtime/transcript/done',
  'thread/realtime/outputAudio/delta',
  'thread/realtime/sdp',
  'thread/realtime/error',
  'thread/realtime/closed',
  'fuzzyFileSearch/sessionUpdated',
  'fuzzyFileSearch/sessionCompleted',
  'rawResponseItem/completed',
  'rawResponse/completed',
];

export class RpcError extends Error {
  readonly code: number | undefined;

  constructor(method: string, error: Record<string, unknown>) {
    super(`${method}: ${String(error['message'] ?? 'error')}`);
    this.code = typeof error['code'] === 'number' ? error['code'] : undefined;
  }
}

export class AppServer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly options: AppServerOptions;
  private nextId = 1;
  private readonly waiting = new Map<
    number,
    { method: string; resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private exited = false;

  private constructor(options: AppServerOptions) {
    this.options = options;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: [...options.pathDirs, process.env['PATH'] ?? ''].join(delimiter),
      ...(options.codexHome ? { CODEX_HOME: options.codexHome } : {}),
    };
    const args = ['app-server', ...(options.config ?? []).flatMap((kv) => ['-c', kv])];
    this.child = spawn(options.binary, args, { cwd: options.cwd, env, windowsHide: true });
    this.child.stdout.on(
      'data',
      lines((line) => this.onLine(line)),
    );
    this.child.stderr.on(
      'data',
      lines((line) => options.onRaw?.('err', line)),
    );
    this.child.on('exit', (code, signal) => {
      this.exited = true;
      for (const w of this.waiting.values())
        w.reject(new Error(`codex app-server exited (${code ?? signal})`));
      this.waiting.clear();
      options.onExit?.(code, signal);
    });
    this.child.on('error', (error) => {
      for (const w of this.waiting.values()) w.reject(error);
      this.waiting.clear();
    });
  }

  /** Starts the server and completes the initialize handshake. */
  static async start(options: AppServerOptions, experimentalApi = true): Promise<AppServer> {
    const server = new AppServer(options);
    await server.request('initialize', {
      clientInfo: { name: 'skaro', title: 'Skaro', version: '0.0.0' },
      capabilities: {
        experimentalApi,
        requestAttestation: false,
        optOutNotificationMethods: OPT_OUT_NOTIFICATIONS,
      },
    });
    server.notify('initialized');
    return server;
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.exited) return Promise.reject(new Error('codex app-server is not running'));
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) =>
      this.waiting.set(id, { method, resolve: resolve as (v: unknown) => void, reject }),
    );
    this.write({ id, method, ...(params === undefined ? {} : { params }) });
    return promise;
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  /** Answers a server request (approval, question, form). */
  reply(id: unknown, result: unknown): void {
    this.write({ id, result });
  }

  /** Stops the server and waits for the process to exit (Windows keeps its cwd locked until then). */
  close(): Promise<void> {
    if (this.exited) return Promise.resolve();
    const exited = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.child.stdin.end();
    this.child.kill();
    return exited;
  }

  private write(msg: Record<string, unknown>): void {
    this.options.onRaw?.('in', msg);
    this.child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private onLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.options.onRaw?.('out', line);
      return;
    }
    this.options.onRaw?.('out', msg);
    this.options.onMessage?.(msg);
    const id = msg['id'];
    if (typeof id === 'number' && typeof msg['method'] !== 'string' && this.waiting.has(id)) {
      const w = this.waiting.get(id)!;
      this.waiting.delete(id);
      const error = msg['error'];
      if (error && typeof error === 'object')
        w.reject(new RpcError(w.method, error as Record<string, unknown>));
      else w.resolve(msg['result']);
    }
  }
}

/** Splits a byte stream into lines. */
export function lines(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString();
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      if (line.trim()) onLine(line);
    }
  };
}
