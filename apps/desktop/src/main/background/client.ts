import { Worker } from 'node:worker_threads';
import type { BackgroundMethods } from './protocol';
import { configureC4Locks } from '@skaro/core';
import { backgroundWorkerEntry } from './worker-entry';

const locks = new SharedArrayBuffer(1024);
const projectScopes = new Map<string, string>();
export function setBackgroundProjectScope(dataDir: string, projectId?: string) {
  if (projectId) projectScopes.set(dataDir, projectId);
  else projectScopes.delete(dataDir);
}
configureC4Locks(locks, 1);

/** Independent queues keep a history replay from delaying document reads or owner decisions. */
class BackgroundLane {
  private worker?: Worker;
  private serial = 0;
  private idleTimer?: NodeJS.Timeout;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(e: Error): void }
  >();
  private readonly dataDir: string;
  private readonly projectScope?: string;
  constructor(dataDir: string, projectScope?: string) {
    this.dataDir = dataDir;
    this.projectScope = projectScope;
  }

  call<M extends keyof BackgroundMethods>(method: M, args: Parameters<BackgroundMethods[M]>) {
    clearTimeout(this.idleTimer);
    if (!this.worker) {
      const worker = new Worker(backgroundWorkerEntry(), {
        workerData: { dataDir: this.dataDir, locks, projectScope: this.projectScope },
      });
      this.worker = worker;
      const owner = worker.threadId + 1;
      worker.unref();
      worker.on('message', (reply: { id: number; value?: unknown; error?: string }) => {
        const request = this.pending.get(reply.id);
        if (!request) return;
        this.pending.delete(reply.id);
        if (!this.pending.size) {
          worker.unref();
          this.idleTimer = setTimeout(() => {
            if (this.worker === worker && !this.pending.size) {
              this.worker = undefined;
              worker.postMessage({ method: 'worker.close' });
            }
          }, 15_000);
          this.idleTimer.unref();
        }
        if (reply.error) request.reject(new Error(reply.error));
        else request.resolve(reply.value);
      });
      const failed = (error: Error) => {
        if (this.worker !== worker) return;
        this.worker = undefined;
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
      };
      worker.on('error', failed);
      worker.on('exit', (code) => {
        const table = new Int32Array(locks);
        for (let i = 0; i < table.length; i++) Atomics.compareExchange(table, i, owner, 0);
        failed(new Error(`Background worker exited (${code})`));
      });
    }
    const worker = this.worker;
    worker.ref();
    const id = ++this.serial;
    return new Promise<Awaited<ReturnType<BackgroundMethods[M]>>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ id, method, args });
    });
  }

  async close(): Promise<void> {
    clearTimeout(this.idleTimer);
    const worker = this.worker;
    if (!worker) return;
    await worker.terminate();
  }
}

const lanes = new Map<string, BackgroundLane>();
export function background<M extends keyof BackgroundMethods>(
  dataDir: string,
  method: M,
  ...args: Parameters<BackgroundMethods[M]>
): Promise<Awaited<ReturnType<BackgroundMethods[M]>>> {
  const lane =
    method === 'models.usage'
      ? 'model-usage'
      : method.startsWith('tasks.')
        ? 'tasks'
        : method.startsWith('chats.')
          ? 'chats'
          : method.startsWith('overview.')
            ? 'overview'
            : method.startsWith('registry.')
              ? 'registry'
              : method.startsWith('read.')
                ? 'views'
                : method.startsWith('history.')
                  ? 'history'
                  : method.startsWith('artifacts.') || method.startsWith('catalog.')
                    ? 'artifacts'
                    : 'storage';
  const key = `${dataDir}\0${projectScopes.get(dataDir) ?? ''}\0${lane}`;
  let worker = lanes.get(key);
  if (!worker) lanes.set(key, (worker = new BackgroundLane(dataDir, projectScopes.get(dataDir))));
  return worker.call(method, args);
}

export async function closeBackground(): Promise<void> {
  await Promise.all([...lanes.values()].map((lane) => lane.close()));
  lanes.clear();
  projectScopes.clear();
}
