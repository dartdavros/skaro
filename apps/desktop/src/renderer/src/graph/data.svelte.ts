import type { C4Model } from '@skaro/core/c4-view';
import type {
  GraphStatus,
  GraphSnapshot,
  GraphPage,
  GraphNode,
  GraphQuery,
  GraphScope,
  GraphFilter,
  GraphScenario,
  GraphViewState,
  SourceRef,
} from '@skaro/core/graph-view';
import { ScenarioPlayback } from './playback.svelte';
import { mergePage } from './page-data';
import { GraphAnalysis } from './analysis.svelte';
import { saveGraphView, restoreGraphView, restoreGraphSelection } from './view-state.svelte';
import { activateScenario } from './scenario-data';
import { connectGraph } from './view-connection';

export class ProjectGraph {
  readonly projectId: string;
  status = $state.raw<GraphStatus>();
  snapshot = $state.raw<GraphSnapshot>();
  page = $state.raw<GraphPage>();
  details = $state.raw<GraphPage>();
  model = $state.raw<C4Model | null>(null);
  scenarios = $state.raw<GraphScenario[]>([]);
  filter = $state<GraphFilter>({ state: 'current' });
  expanded = $state<string[]>([]);
  selected = $state('');
  error = $state('');
  loading = $state(false);
  focus = $state('');
  focusRequest = $state(0);
  highlighted = $state<string[]>([]);
  history = $state<string[]>([]);
  historyIndex = $state(-1);
  readonly playback = new ScenarioPlayback();
  readonly analysis = new GraphAnalysis(this);
  saved?: GraphViewState;
  camera?: GraphViewState['camera'];
  positions: NonNullable<GraphViewState['positions']> = {};
  private connection?: ReturnType<typeof connectGraph>;
  private revision = 0;
  private disposed = false;
  private persistTimer?: ReturnType<typeof setTimeout>;
  private initializing = true;
  private pendingStatus?: GraphStatus;
  private loadingSnapshot?: string;
  constructor(projectId: string) {
    this.projectId = projectId;
  }
  scope(snapshot = this.snapshot): GraphScope {
    if (!snapshot) throw new Error('Graph has no published snapshot');
    return {
      projectId: this.projectId,
      checkoutId: snapshot.checkoutId,
      snapshotId: snapshot.id,
      requestId: crypto.randomUUID(),
    };
  }
  async start(): Promise<void> {
    this.connection = connectGraph(this.projectId, (status) => {
      if (this.initializing) this.pendingStatus = status;
      else void this.receive(status);
    });
    try {
      const [status, saved] = await Promise.all([
        this.connection.open(),
        window.skaro.invoke('graph.view', this.projectId),
      ]);
      if (this.disposed) return;
      restoreGraphView(this, saved, status.snapshot?.checkoutId);
      this.initializing = false;
      await this.receive(this.pendingStatus ?? status);
    } catch (error) {
      this.error = String(error);
    }
  }
  private async receive(status: GraphStatus): Promise<void> {
    this.status = status;
    if (this.playback.scenario && ['stale', 'queued', 'indexing'].includes(status.phase))
      this.playback.invalidate();
    if (
      !status.snapshot ||
      status.snapshot.id === this.snapshot?.id ||
      status.snapshot.id === this.loadingSnapshot
    )
      return;
    if (this.playback.scenario && this.snapshot) {
      this.playback.invalidate();
      return;
    }
    await this.load(status.snapshot);
  }
  async load(snapshot = this.status?.snapshot): Promise<void> {
    if (!snapshot) return;
    const serial = ++this.revision;
    this.loadingSnapshot = snapshot.id;
    this.loading = true;
    try {
      if (this.snapshot?.id !== snapshot.id) this.analysis.clear();
      const scope = this.scope(snapshot);
      const [page, model, scenarios] = await Promise.all([
        window.skaro.invoke(
          'graph.query',
          $state.snapshot({
            ...scope,
            operation: 'overview',
            filter: this.filter,
            expanded: this.expanded,
          }),
        ),
        window.skaro.invoke('graph.model', scope),
        window.skaro.invoke('graph.scenarios', scope),
      ]);
      if (serial !== this.revision || this.disposed) return;
      if (this.playback.scenario && this.playback.scenario.snapshotId !== snapshot.id) {
        this.playback.invalidate();
        return;
      }
      this.snapshot = snapshot;
      this.page = page;
      this.model = model;
      this.scenarios = scenarios;
      this.error = '';
      await restoreGraphSelection(this);
    } catch (error) {
      if (!this.disposed && serial === this.revision) this.error = String(error);
    } finally {
      if (serial === this.revision) {
        this.loading = false;
        this.loadingSnapshot = undefined;
      }
    }
  }
  query(part: Partial<GraphQuery> & Pick<GraphQuery, 'operation'>): Promise<GraphPage> {
    const filter: GraphFilter = this.playback.scenario
      ? { state: 'all' }
      : $state.snapshot(this.filter);
    return window.skaro.invoke(
      'graph.query',
      $state.snapshot({ ...this.scope(), filter, ...part }),
    );
  }
  async refresh(): Promise<void> {
    if (
      this.status?.snapshot &&
      this.status.snapshot.id !== this.snapshot?.id &&
      !this.playback.scenario
    ) {
      await this.load(this.status.snapshot);
      return;
    }
    if (!this.snapshot) return;
    const serial = ++this.revision;
    this.loading = true;
    try {
      const page = await this.query({ operation: 'overview', expanded: this.expanded });
      if (!this.disposed && serial === this.revision) {
        this.page = page;
        this.error = '';
      }
    } catch (error) {
      this.error = String(error);
    } finally {
      if (serial === this.revision) this.loading = false;
    }
    this.persist();
  }
  async more(): Promise<void> {
    if (!this.page?.cursor || this.page.nodes.length >= 5000) return;
    const basis = this.page;
    try {
      const next = await this.query({
        operation: 'overview',
        expanded: this.expanded,
        cursor: this.page.cursor,
      });
      if (next.snapshotId === this.snapshot?.id && this.page?.queryHash === basis.queryHash)
        this.page = mergePage(this.page, next);
    } catch (error) {
      this.error = String(error);
    }
  }
  async search(text: string): Promise<GraphNode[]> {
    if (!this.snapshot) return [];
    return (await this.query({ operation: 'search', text, limit: 100 })).nodes;
  }
  async expand(id: string): Promise<void> {
    const ancestors = id.startsWith('group:')
      ? id
          .slice(6)
          .split('/')
          .flatMap((_part, index, all) =>
            index >= 1 ? [`group:${all.slice(0, index + 1).join('/')}`] : [],
          )
      : [];
    this.expanded = [...this.expanded, ...ancestors, id].filter(
      (value, index, all) => all.indexOf(value) === index,
    );
    await this.refresh();
  }
  async select(id: string, record = true): Promise<void> {
    const snapshot = this.snapshot?.id;
    this.selected = id;
    this.details = undefined;
    if (record && id) {
      this.history = [...this.history.slice(0, this.historyIndex + 1), id].slice(-100);
      this.historyIndex = this.history.length - 1;
    }
    if (id && !id.startsWith('group:') && !id.startsWith('aggregate:')) {
      try {
        const details = await this.query({ operation: 'details', id });
        if (this.selected === id && snapshot === this.snapshot?.id) this.details = details;
      } catch (error) {
        if (this.selected === id && snapshot === this.snapshot?.id) this.error = String(error);
      }
    }
    this.persist();
  }
  async focusNode(id: string): Promise<void> {
    const revision = this.revision;
    try {
      const context = await this.query({ operation: 'neighbors', id, depth: 1, direction: 'both' });
      if (context.snapshotId !== this.snapshot?.id || revision !== this.revision) return;
      this.page = mergePage(this.page, context);
      await this.select(id);
      this.focus = id;
      this.focusRequest++;
    } catch (error) {
      this.error = String(error);
    }
  }
  back(delta: number): void {
    const next = this.historyIndex + delta;
    if (next < 0 || next >= this.history.length) return;
    this.historyIndex = next;
    void this.select(this.history[next]!, false);
  }
  async neighbors(id: string): Promise<void> {
    await this.focusNode(id);
  }
  async path(
    from: string,
    target: string,
    direction: 'out' | 'both',
    depth: number,
  ): Promise<GraphPage> {
    const revision = this.revision;
    const result = await this.query({ operation: 'path', id: from, target, direction, depth });
    if (result.snapshotId !== this.snapshot?.id || revision !== this.revision)
      throw new Error('graph-query-expired');
    this.page = mergePage(this.page, result);
    this.highlighted = result.path ?? [];
    return result;
  }
  async impact(id: string, depth: number): Promise<GraphPage> {
    const revision = this.revision;
    const result = await this.query({ operation: 'impact', id, depth, direction: 'in' });
    if (result.snapshotId !== this.snapshot?.id || revision !== this.revision)
      throw new Error('graph-query-expired');
    this.page = mergePage(this.page, result);
    this.highlighted = result.edges.map((edge) => edge.id);
    return result;
  }
  async scenario(viewId: string): Promise<void> {
    try {
      await activateScenario(this, viewId);
    } catch (error) {
      this.error = String(error);
      this.playback.pause();
    }
  }
  async latest(): Promise<void> {
    const id = this.playback.scenario?.viewId;
    this.playback.close();
    await this.load();
    if (id) await this.scenario(id);
  }
  source(ref: SourceRef) {
    return window.skaro.invoke('graph.source', this.scope(), ref);
  }
  persist(): void {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      if (!this.disposed) saveGraphView(this);
    }, 250);
  }
  dispose(): void {
    this.playback.pause();
    saveGraphView(this);
    this.connection?.close();
    this.disposed = true;
    ++this.revision;
    clearTimeout(this.persistTimer);
  }
}
