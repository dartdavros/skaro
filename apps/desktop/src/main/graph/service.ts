import { realpath, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { C4Model } from '@skaro/core/c4-view';
import type {
  GraphStatus,
  GraphSnapshot,
  GraphQuery,
  GraphScope,
  GraphPage,
  GraphScenario,
  SourceRef,
  GraphViewState,
} from '@skaro/core/graph-view';
import type { AppState } from '../state';
import { hash } from './facts';
import { GraphJobs } from './jobs';
import { GraphWatch } from './watch';
import { GraphWorkerClient } from './worker-client';

interface Root {
  source: string;
  root: string;
  database: string;
}
export class GraphService {
  private readonly state: AppState;
  private readonly directory: string;
  private readonly jobs: GraphJobs;
  private readonly queryWorker = new GraphWorkerClient();
  private readonly watch: GraphWatch;
  private readonly roots = new Map<string, Root>();
  private readonly pending = new Map<string, Promise<Root>>();
  private timer?: NodeJS.Timeout;
  private closed = false;
  constructor(state: AppState, dataDir: string, changed: (status: GraphStatus) => void) {
    this.state = state;
    this.directory = join(dataDir, 'graph');
    this.jobs = new GraphJobs(this.directory, changed, state.db.shell.projectScope);
    this.watch = new GraphWatch(
      (id) => {
        void this.rebuild(id).catch(() => undefined);
      },
      (id, error) => {
        const previous = this.jobs.statuses.get(id);
        this.jobs.publish({
          ...previous,
          projectId: id,
          generation: previous?.generation ?? 0,
          phase: 'unavailable',
          error: error.message,
        });
      },
    );
  }
  start(): void {
    setImmediate(() => void this.reconcile());
    this.timer = setInterval(() => void this.reconcile(true), 180_000);
    this.timer.unref();
  }
  private async reconcile(refresh = false): Promise<void> {
    if (this.closed) return;
    const projects = this.state.listProjects(),
      ids = new Set(projects.map((project) => project.id));
    for (const id of this.roots.keys()) if (!ids.has(id)) await this.remove(id);
    for (const project of projects) {
      try {
        const known = this.roots.get(project.id);
        if (refresh && known) {
          const actual = await realpath(project.path);
          if (actual !== known.root) {
            this.roots.delete(project.id);
            this.jobs.cancel(project.id);
            this.watch.remove(project.id);
          }
        }
        const root = await this.ensure(project.id);
        if (refresh && known && this.jobs.statuses.get(project.id)?.phase !== 'cancelled')
          this.jobs.enqueue({ projectId: project.id, ...root });
      } catch (error) {
        this.unavailable(project.id, error);
      }
    }
  }
  private unavailable(id: string, error: unknown): void {
    const previous = this.jobs.statuses.get(id);
    this.jobs.publish({
      ...previous,
      projectId: id,
      generation: previous?.generation ?? 0,
      phase: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
    });
  }
  private ensure(id: string): Promise<Root> {
    const project = this.state.project(id),
      previous = this.roots.get(id);
    const pending = this.pending.get(id);
    if (pending) return pending;
    if (previous?.source === project.path) return Promise.resolve(previous);
    const operation = (async () => {
      const root = await realpath(project.path);
      const entry = {
        source: project.path,
        root,
        database: join(
          this.directory,
          hash(id).slice(0, 20),
          hash(root).slice(0, 20),
          'index.sqlite',
        ),
      };
      if (previous) {
        this.jobs.cancel(id);
        this.jobs.statuses.delete(id);
      }
      this.roots.set(id, entry);
      this.watch.add(id, root);
      const snapshot = await this.queryWorker.call<GraphSnapshot | null>('status', entry);
      if (snapshot)
        this.jobs.publish({
          projectId: id,
          generation: snapshot.generation,
          snapshot,
          phase: 'stale',
        });
      this.jobs.enqueue({ projectId: id, ...entry });
      return entry;
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, operation);
    return operation;
  }
  async register(id: string): Promise<void> {
    await this.ensure(id);
  }
  async status(id: string): Promise<GraphStatus> {
    try {
      await this.ensure(id);
    } catch (error) {
      this.unavailable(id, error);
    }
    return this.jobs.statuses.get(id)!;
  }
  async rebuild(id: string, force = false): Promise<GraphStatus> {
    const root = await this.ensure(id);
    return this.jobs.enqueue({ projectId: id, ...root, force });
  }
  cancel(id: string): GraphStatus {
    this.state.project(id);
    return this.jobs.cancel(id);
  }
  private async scoped(scope: GraphScope): Promise<Root> {
    if (!scope || typeof scope.projectId !== 'string') throw new Error('Invalid graph project');
    const root = await this.ensure(scope.projectId),
      status = this.jobs.statuses.get(scope.projectId);
    if (status?.snapshot && status.snapshot.checkoutId !== scope.checkoutId)
      throw new Error('graph-checkout-changed');
    return root;
  }
  async query(query: GraphQuery): Promise<GraphPage> {
    const root = await this.scoped(query);
    return this.queryWorker.call('query', { ...root, query });
  }
  async exportPage(
    scope: GraphScope,
    kind: 'nodes' | 'edges',
    after?: string,
  ): Promise<import('../../shared/diagram-export').GraphExportPage> {
    const root = await this.scoped(scope);
    return this.queryWorker.call('export', { ...root, scope, kind, after });
  }
  async scenarios(scope: GraphScope): Promise<GraphScenario[]> {
    const root = await this.scoped(scope);
    return this.queryWorker.call('scenarios', { ...root, scope });
  }
  async source(
    scope: GraphScope,
    ref: SourceRef,
  ): Promise<{ path: string; text: string; line: number }> {
    const root = await this.scoped(scope);
    return this.queryWorker.call('source', { ...root, scope, ref });
  }
  async model(id: string, scope?: GraphScope): Promise<C4Model | null> {
    if (scope && scope.projectId !== id) throw new Error('Invalid graph model scope');
    const root = scope ? await this.scoped(scope) : await this.ensure(id);
    return this.queryWorker.call('model', { ...root, ...(scope ? { scope } : {}) });
  }
  view(id: string): GraphViewState | null {
    this.state.project(id);
    return this.state.getSetting(`graph.view.${id}`) as GraphViewState | null;
  }
  saveView(id: string, view: GraphViewState): void {
    this.state.project(id);
    if (
      !view ||
      view.version !== 1 ||
      typeof view.checkoutId !== 'string' ||
      !Array.isArray(view.expanded) ||
      view.expanded.length > 500 ||
      !Array.isArray(view.history) ||
      view.history.length > 100 ||
      JSON.stringify(view).length > 1_000_000
    )
      throw new Error('Invalid graph view state');
    if (
      view.camera &&
      Object.values(view.camera).some(
        (value) => typeof value !== 'number' || !Number.isFinite(value),
      )
    )
      throw new Error('Invalid graph camera');
    if (
      view.positions &&
      (Object.keys(view.positions).length > 5000 ||
        Object.values(view.positions).some(
          (point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y),
        ))
    )
      throw new Error('Invalid graph positions');
    this.state.setSetting(`graph.view.${id}`, view);
  }
  async remove(id: string): Promise<void> {
    await this.pending.get(id)?.catch(() => undefined);
    this.watch.remove(id);
    this.roots.delete(id);
    await this.jobs.forget(id);
    const target = resolve(this.directory, hash(id).slice(0, 20)),
      inside = relative(resolve(this.directory), target);
    if (!inside || inside.startsWith('..') || isAbsolute(inside))
      throw new Error('Invalid graph cache removal target');
    await rm(target, { recursive: true, force: true });
  }
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    this.watch.close();
    await Promise.all([this.jobs.close(), this.queryWorker.close()]);
  }
}
