import { utilityProcess, type UtilityProcess } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphStatus } from '@skaro/core/graph-view';

type Progress = NonNullable<GraphStatus['progress']>;
interface Reply {
  id: number;
  value?: unknown;
  error?: string;
  progress?: Progress;
}

interface Request {
  resolve(value: unknown): void;
  reject(error: Error): void;
  progress?: (value: Progress) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Child {
  process: UtilityProcess;
  exited: Promise<void>;
}

export class GraphWorkerClient {
  private readonly name: string;
  private child?: Child;
  private serial = 0;
  private readonly pending = new Map<number, Request>();
  private closing?: Promise<void>;

  constructor(name: string) {
    this.name = name;
  }

  async call<T>(
    operation: string,
    args: unknown,
    progress?: (value: Progress) => void,
  ): Promise<T> {
    if (this.closing) throw new Error('graph-cancelled');
    const child = this.child ?? this.spawn();
    return new Promise<T>((resolve, reject) => {
      const id = ++this.serial;
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        ...(progress && { progress }),
        timer: setTimeout(
          () => {
            this.fail(new Error('graph-worker-time-budget'));
            void this.close();
          },
          operation === 'index' ? 180_000 : operation === 'prune' ? 60_000 : 15_000,
        ),
      });
      try {
        child.process.postMessage({ id, operation, args });
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        void this.close();
      }
    });
  }

  private spawn(): Child {
    const bundled = join(__dirname, 'graph-worker.js'),
      chunked = join(__dirname, '../graph-worker.js'),
      built = join(__dirname, '../../../out/main/graph-worker.js');
    const entry = existsSync(bundled) ? bundled : existsSync(chunked) ? chunked : built;
    const process = utilityProcess.fork(entry, [], {
      serviceName: this.name,
      execArgv: ['--max-old-space-size=1536'],
    });
    let exited!: () => void;
    const child = { process, exited: new Promise<void>((resolve) => (exited = resolve)) };
    this.child = child;
    process.on('message', (reply: Reply) => this.receive(reply));
    process.once('exit', (code) => {
      if (this.child === child) {
        this.child = undefined;
        this.fail(new Error(`Graph process exited (${code})`));
      }
      exited();
    });
    return child;
  }

  private receive(reply: Reply): void {
    const request = this.pending.get(reply.id);
    if (!request) return;
    if (reply.progress) {
      request.progress?.(reply.progress);
      return;
    }
    this.pending.delete(reply.id);
    clearTimeout(request.timer);
    if (reply.error !== undefined) request.reject(new Error(reply.error));
    else request.resolve(reply.value);
  }

  private fail(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.fail(new Error('graph-cancelled'));
    this.closing = this.child ? this.stop(this.child) : Promise.resolve();
    return this.closing;
  }

  private async stop({ process, exited }: Child): Promise<void> {
    // Let async work cancel child Git commands before terminating a blocked parser.
    const timer = setTimeout(() => process.kill(), 1_000);
    try {
      process.postMessage({ operation: 'shutdown' });
    } catch {
      process.kill();
    }
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  }
}
