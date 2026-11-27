import { realpath, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { C4Model } from '@skaro/core/c4-view';
import type {
  GraphStatus,
  GraphQuery,
  GraphScope,
  GraphPage,
  GraphScenario,
  SourceRef,
  GraphViewState,
} from '@skaro/core/graph-view';
import type { GraphEvents } from '../../shared/graph';
import type { AppState } from '../state';
import { hash } from './facts';
import { GraphSession } from './session';

interface ActiveGraph {
  session: GraphSession;
  input?: { projectId: string; root: string; database: string };
}

export class GraphService {
  private readonly state: AppState;
  private readonly directory: string;
  private readonly changed: (status: GraphEvents['graph.changed']) => void;
  private active?: ActiveGraph;
  private stopping = Promise.resolve();
  private closed = false;

  constructor(
    state: AppState,
    dataDir: string,
    changed: (status: GraphEvents['graph.changed']) => void,
  ) {
    this.state = state;
    this.directory = join(dataDir, 'graph');
    this.changed = changed;
  }

  async open(projectId: string, token: string): Promise<GraphStatus> {
    if (this.closed || typeof token !== 'string' || !/^[\da-f-]{36}$/i.test(token))
      throw new Error('Invalid graph view');
    const project = this.state.project(projectId);
    if (this.active?.session.token === token && this.active.session.projectId === projectId)
      return this.active.session.status;
    const stopping = this.deactivate();
    const session = new GraphSession(token, projectId, (status) =>
      this.changed({ ...status, token }),
    );
    const active: ActiveGraph = { session };
    this.active = active;
    try {
      await stopping;
      if (this.active !== active) return session.status;
      const root = await realpath(project.path);
      if (this.active !== active) return session.status;
      active.input = {
        projectId,
        root,
        database: join(
          this.directory,
          hash(projectId).slice(0, 20),
          hash(root).slice(0, 20),
          'index.sqlite',
        ),
      };
      return await session.open(active.input);
    } catch (error) {
      return session.unavailable(error);
    }
  }

  deactivate(token?: string): Promise<void> {
    if (token !== undefined && this.active?.session.token !== token) return this.stopping;
    const active = this.active;
    if (active) {
      this.active = undefined;
      this.stopping = Promise.all([this.stopping, active.session.close()]).then(() => undefined);
    }
    return this.stopping;
  }

  status(projectId: string): GraphStatus {
    this.state.project(projectId);
    if (this.active?.session.projectId === projectId) return this.active.session.status;
    return { projectId, generation: 0, phase: 'cancelled' };
  }

  rebuild(projectId: string): GraphStatus {
    const { session, input } = this.openProject(projectId);
    return session.rebuild(input, true);
  }

  cancel(projectId: string): GraphStatus {
    const session = this.active?.session;
    if (session?.projectId !== projectId) return this.status(projectId);
    return session.cancel();
  }

  query(query: GraphQuery): Promise<GraphPage> {
    return this.read(query, 'query', { query });
  }

  exportPage(scope: GraphScope, kind: 'nodes' | 'edges', after?: string) {
    return this.read<import('../../shared/diagram-export').GraphExportPage>(scope, 'export', {
      kind,
      after,
    });
  }

  scenarios(scope: GraphScope): Promise<GraphScenario[]> {
    return this.read(scope, 'scenarios');
  }

  source(scope: GraphScope, ref: SourceRef): Promise<{ path: string; text: string; line: number }> {
    return this.read(scope, 'source', { ref });
  }

  model(scope: GraphScope): Promise<C4Model | null> {
    return this.read(scope, 'model');
  }

  private openProject(projectId: string) {
    this.state.project(projectId);
    const active = this.active;
    if (!active?.input || active.session.projectId !== projectId)
      throw new Error('Graph view is closed');
    return { session: active.session, input: active.input };
  }

  private async read<T>(scope: GraphScope, operation: string, args?: object): Promise<T> {
    if (!scope || typeof scope.projectId !== 'string') throw new Error('Invalid graph project');
    const { session, input } = this.openProject(scope.projectId);
    if (session.status.snapshot?.checkoutId !== scope.checkoutId)
      throw new Error('graph-checkout-changed');
    return session.reader.call<T>(operation, { ...input, ...args, scope });
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
    if (this.active?.session.projectId === id) await this.deactivate();
    else await this.stopping;
    const target = resolve(this.directory, hash(id).slice(0, 20));
    const inside = relative(resolve(this.directory), target);
    if (!inside || inside.startsWith('..') || isAbsolute(inside))
      throw new Error('Invalid graph cache removal target');
    await rm(target, { recursive: true, force: true });
  }

  close(): Promise<void> {
    this.closed = true;
    return this.deactivate();
  }
}
