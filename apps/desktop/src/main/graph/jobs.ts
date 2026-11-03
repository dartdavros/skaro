import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphStatus, GraphSnapshot } from '@skaro/core/graph-view';
import { GraphWorkerClient } from './worker-client';
import type { IndexJob } from './indexer';
import { publishSnapshot } from './publish';

/** One independent indexing lane; queries use a different worker. Pending jobs survive app exit. */
export class GraphJobs {
  readonly statuses = new Map<string, GraphStatus>();
  private readonly queue = new Map<string, IndexJob>();
  private active?: IndexJob;
  private cancellation?: Int32Array;
  private readonly worker = new GraphWorkerClient();
  private readonly directory: string;
  private readonly queueFile: string;
  private readonly changed: (status: GraphStatus) => void;
  private closing = false;
  private readonly recovered = new Map<string, { generation: number; force: boolean }>();
  constructor(directory: string, changed: (status: GraphStatus) => void, projectScope?: string) {
    this.directory = directory;
    if (projectScope && !/^[a-zA-Z0-9_-]{1,160}$/.test(projectScope))
      throw new Error('Invalid graph project scope');
    this.queueFile = projectScope ? `jobs-${projectScope}.json` : 'jobs.json';
    this.changed = changed;
    mkdirSync(directory, { recursive: true });
    try {
      const saved = JSON.parse(readFileSync(join(directory, this.queueFile), 'utf8')) as {
        version: number;
        jobs: IndexJob[];
      };
      if (saved.version === 1 && Array.isArray(saved.jobs))
        for (const job of saved.jobs.slice(0, 1000)) {
          if (typeof job.projectId === 'string' && Number.isSafeInteger(job.generation))
            this.recovered.set(job.projectId, {
              generation: job.generation,
              force: job.force === true,
            });
        }
    } catch {
      /* Missing or interrupted queue is rebuilt from registered projects. */
    }
  }
  publish(status: GraphStatus): void {
    this.statuses.set(status.projectId, status);
    this.changed(status);
  }
  enqueue(input: Omit<IndexJob, 'generation'>): GraphStatus {
    const previous = this.statuses.get(input.projectId);
    const resumed = this.recovered.get(input.projectId);
    this.recovered.delete(input.projectId);
    const generation = Math.max(previous?.generation ?? 0, resumed?.generation ?? 0) + 1;
    const job = { ...input, force: input.force || resumed?.force || false, generation };
    this.queue.set(input.projectId, job);
    const status: GraphStatus = {
      projectId: input.projectId,
      generation,
      phase: previous?.snapshot ? 'stale' : 'queued',
      ...(previous?.snapshot ? { snapshot: previous.snapshot } : {}),
    };
    this.publish(status);
    this.persist();
    if (this.active?.projectId === input.projectId) this.stop();
    setImmediate(() => void this.pump());
    return status;
  }
  cancel(id: string): GraphStatus {
    this.queue.delete(id);
    const previous = this.statuses.get(id);
    const status: GraphStatus = {
      projectId: id,
      generation: (previous?.generation ?? 0) + 1,
      phase: 'cancelled',
      ...(previous?.snapshot ? { snapshot: previous.snapshot } : {}),
    };
    this.publish(status);
    this.persist();
    if (this.active?.projectId === id) this.stop();
    return status;
  }
  async forget(id: string): Promise<void> {
    this.queue.delete(id);
    this.statuses.delete(id);
    if (this.active?.projectId === id) {
      this.stop();
      await this.worker.close();
    }
    this.persist();
  }
  private async pump(): Promise<void> {
    if (this.active || this.closing || !this.queue.size) return;
    const job = this.queue.values().next().value!;
    this.queue.delete(job.projectId);
    this.active = job;
    const cancellation = new SharedArrayBuffer(4);
    this.cancellation = new Int32Array(cancellation);
    Atomics.store(this.cancellation, 0, 1);
    this.persist();
    const prior = this.statuses.get(job.projectId);
    this.publish({ ...prior!, phase: 'indexing' });
    try {
      const snapshot = await this.worker.call<GraphSnapshot>(
        'index',
        { ...job, cancellation },
        (progress) => {
          const current = this.statuses.get(job.projectId);
          if (current?.generation === job.generation)
            this.publish({ ...current, progress, phase: 'indexing' });
        },
      );
      if (!this.closing && this.statuses.get(job.projectId)?.generation === job.generation) {
        publishSnapshot(job.database, snapshot);
        this.publish({
          projectId: job.projectId,
          generation: job.generation,
          snapshot,
          phase:
            snapshot.coverage.errors || snapshot.coverage.skipped || snapshot.coverage.unresolved
              ? 'partial'
              : 'ready',
        });
        this.persist();
        // Cleanup never delays publication or changes a successfully published status.
        await this.worker.call('prune', job).catch(() => undefined);
      }
    } catch (error) {
      if (!this.closing && this.statuses.get(job.projectId)?.generation === job.generation) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'graph-source-changed') this.enqueue(job);
        else
          this.publish({
            ...this.statuses.get(job.projectId)!,
            phase: message === 'graph-cancelled' ? 'cancelled' : 'error',
            error: message,
          });
      }
    } finally {
      this.active = undefined;
      this.cancellation = undefined;
      if (!this.closing) this.persist();
      setImmediate(() => void this.pump());
    }
  }
  private persist(): void {
    const destination = join(this.directory, this.queueFile),
      temporary = destination + '.tmp';
    writeFileSync(
      temporary,
      JSON.stringify({
        version: 1,
        jobs: [
          ...(this.active &&
          this.statuses.get(this.active.projectId)?.generation === this.active.generation &&
          this.statuses.get(this.active.projectId)?.phase === 'indexing'
            ? [this.active]
            : []),
          ...this.queue.values(),
        ],
      }),
    );
    renameSync(temporary, destination);
  }
  private stop(): void {
    if (this.cancellation) Atomics.store(this.cancellation, 0, 0);
    void this.worker.close();
  }
  async close(): Promise<void> {
    this.closing = true;
    this.persist();
    if (this.cancellation) Atomics.store(this.cancellation, 0, 0);
    await this.worker.close();
  }
}
