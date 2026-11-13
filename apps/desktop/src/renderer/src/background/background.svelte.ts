import type { BackgroundJob, BackgroundState } from '../../../shared/background';
import { SvelteMap } from 'svelte/reactivity';
import { projectDialog } from '../decisions/dialog.svelte';
import { decisions } from '../decisions/decisions.svelte';
import { audit } from '../c4/audit.svelte';
import { c4AuditJob } from '../../../shared/c4-audit-job';

/** The temporary list and durable project journal share a window, not storage or authority. */
class Background {
  private live = $state.raw<BackgroundJob[]>([]);
  archive = $state.raw<BackgroundJob[]>([]);
  loading = $state(false);
  error = $state(false);
  nextCursor = $state<number>();
  projectId = $state<string>();
  private watching = false;
  private generation = 0;
  private fetching?: number;
  private again?: number;
  get open() {
    return projectDialog.view === 'recent' || projectDialog.view === 'journal';
  }
  set open(value: boolean) {
    projectDialog.view = value ? 'recent' : 'none';
    if (value) void this.read();
  }
  get journal() {
    return projectDialog.view === 'journal';
  }
  get jobs(): BackgroundJob[] {
    const scoped = this.live.filter((job) =>
      this.projectId ? job.projectId === this.projectId : !job.projectId,
    );
    if (!this.projectId) return scoped;
    const pending: BackgroundJob[] = decisions.cards
      .filter((card) => ['pending', 'error', 'stale', 'sending'].includes(card.status))
      .filter((card) => card.entry?.origin.id !== audit.current?.chatId)
      .map((card) => ({
        id: `decision:${card.entry!.id}`,
        projectId: this.projectId,
        taskId: card.entry!.origin.kind === 'task' ? card.entry!.origin.id : undefined,
        decisionId: card.entry!.id,
        what: 'decision.waiting',
        state: 'running',
        startedAt: 0,
      }));
    const auditRows =
      audit.current?.projectId === this.projectId ? [c4AuditJob(audit.current)] : [];
    const known = new Set([...scoped, ...auditRows].map((job) => job.id));
    const recent = this.archive.filter(
      (job) => !known.has(job.id) && Date.now() - (job.endedAt ?? 0) < 30 * 60_000,
    );
    return [...pending, ...auditRows, ...scoped, ...recent].slice(0, 60);
  }
  get running() {
    return this.jobs.filter((job) => job.state === 'running');
  }
  get recent() {
    return this.jobs.filter((job) => job.state !== 'running');
  }
  get failed() {
    return this.recent.some((job) => job.state === 'failed');
  }
  scope(projectId?: string) {
    if (this.projectId === projectId) return;
    this.generation++;
    this.projectId = projectId;
    audit.scope(projectId);
    this.archive = [];
    this.nextCursor = undefined;
    this.error = false;
    if (projectId) void this.read();
  }
  async load() {
    if (!this.watching) {
      this.watching = true;
      window.skaro.on('background.changed', (state: BackgroundState) => {
        this.live = state.jobs;
        if (this.open && this.projectId) void this.read();
      });
      window.skaro.on('decisions.changed', ({ projectId }) => {
        if (projectId === this.projectId && this.open) void this.read();
      });
      window.skaro.on('project.changed', ({ projectId }) => {
        if (projectId === this.projectId && this.open) void this.read();
      });
      window.skaro.on('task.changed', ({ projectId }) => {
        if (projectId === this.projectId && this.open) void this.read();
      });
    }
    try {
      this.live = (await window.skaro.invoke('background.state')).jobs;
    } catch {
      this.error = true;
    }
  }
  async read(more = false) {
    const projectId = this.projectId,
      generation = this.generation;
    if (!projectId) return;
    if (this.fetching === generation) {
      if (!more) this.again = generation;
      return;
    }
    this.fetching = generation;
    this.loading = true;
    this.error = false;
    try {
      const page = await window.skaro.invoke(
        'activity.page',
        projectId,
        more ? this.nextCursor : undefined,
      );
      if (generation !== this.generation) return;
      const unique = new SvelteMap<string, BackgroundJob>();
      for (const job of more ? [...this.archive, ...page.jobs] : page.jobs)
        if (!unique.has(job.id)) unique.set(job.id, job);
      this.archive = [...unique.values()];
      this.nextCursor = page.nextCursor;
    } catch {
      if (generation === this.generation) this.error = true;
    } finally {
      if (this.fetching === generation) this.fetching = undefined;
      if (generation === this.generation) this.loading = false;
      if (this.again === generation) {
        this.again = undefined;
        if (generation === this.generation) void this.read();
      }
    }
  }
  history() {
    projectDialog.view = 'journal';
    void this.read();
  }
  recentView() {
    projectDialog.view = 'recent';
    void this.read();
  }
  openDecision() {
    decisions.show();
  }
}
export const background = new Background();
