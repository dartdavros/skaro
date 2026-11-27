import type { GraphSnapshot, GraphStatus } from '@skaro/core/graph-view';
import type { IndexJob } from './indexer';
import { publishSnapshot } from './publish';
import { GraphWorkerClient } from './worker-client';

type ProjectIndex = Omit<IndexJob, 'generation' | 'force'>;

/** Owned by one open graph view. Queries can read the last snapshot during a rebuild. */
export class GraphSession {
  readonly token: string;
  readonly projectId: string;
  readonly reader = new GraphWorkerClient('Skaro Graph Queries');
  private readonly changed: (status: GraphStatus) => void;
  status: GraphStatus;
  private closed = false;
  private indexer?: GraphWorkerClient;
  private stopping = Promise.resolve();

  constructor(token: string, projectId: string, changed: (status: GraphStatus) => void) {
    this.token = token;
    this.projectId = projectId;
    this.changed = changed;
    this.status = { projectId, phase: 'queued', generation: 0 };
  }

  async open(input: ProjectIndex): Promise<GraphStatus> {
    if (this.closed) return this.status;
    try {
      const snapshot = await this.reader.call<GraphSnapshot | null>('status', input);
      if (this.closed || this.status.generation !== 0) return this.status;
      if (snapshot) this.status = { ...this.status, generation: snapshot.generation, snapshot };
      return this.rebuild(input);
    } catch (error) {
      return this.unavailable(error);
    }
  }

  unavailable(error: unknown): GraphStatus {
    if (!this.closed && this.status.generation === 0) this.update('unavailable', String(error));
    return this.status;
  }

  rebuild(input: ProjectIndex, force = false): GraphStatus {
    if (this.closed) return this.status;
    const generation = this.status.generation + 1;
    this.stopIndex();
    this.status = { ...this.status, generation };
    this.update(this.status.snapshot ? 'stale' : 'queued');
    void this.build({ ...input, generation, force });
    return this.status;
  }

  cancel(): GraphStatus {
    this.stopIndex();
    this.status = { ...this.status, generation: this.status.generation + 1 };
    return this.update('cancelled');
  }

  async close(): Promise<void> {
    this.closed = true;
    this.cancel();
    await Promise.all([this.reader.close(), this.stopping]);
  }

  private current(generation: number): boolean {
    return !this.closed && generation === this.status.generation;
  }

  private update(phase: GraphStatus['phase'], error?: string): GraphStatus {
    const { projectId, generation, snapshot } = this.status;
    this.status = {
      projectId,
      generation,
      phase,
      ...(snapshot && { snapshot }),
      ...(error && { error }),
    };
    this.changed(this.status);
    return this.status;
  }

  private stopIndex(): void {
    if (!this.indexer) return;
    this.stopping = this.indexer.close();
    this.indexer = undefined;
  }

  private async build(job: IndexJob): Promise<void> {
    await this.stopping;
    const { generation } = job;
    if (!this.current(generation)) return;
    const indexer = new GraphWorkerClient('Skaro Graph Index');
    this.indexer = indexer;
    this.update('indexing');
    try {
      const snapshot = await indexer.call<GraphSnapshot>('index', job, (progress) => {
        if (!this.current(generation)) return;
        this.status = { ...this.status, progress };
        this.changed(this.status);
      });
      if (!this.current(generation)) return;
      publishSnapshot(job.database, snapshot);
      this.status = { ...this.status, snapshot };
      const { errors, skipped, unresolved } = snapshot.coverage;
      this.update(errors || skipped || unresolved ? 'partial' : 'ready');
      await indexer.call('prune', job).catch(() => undefined);
    } catch (error) {
      if (this.current(generation))
        this.update('error', error instanceof Error ? error.message : String(error));
    } finally {
      if (this.indexer === indexer) this.stopIndex();
      await indexer.close();
    }
  }
}
