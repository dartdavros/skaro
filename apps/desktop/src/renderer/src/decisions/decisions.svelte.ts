import { SvelteMap } from 'svelte/reactivity';
import type { ProjectDecision } from '../../../shared/project-decisions';
import { DecisionCardState } from './card-state.svelte';
import { projectDialog } from './dialog.svelte';

class ProjectDecisions {
  project = $state<{ id: string; name: string }>();
  cards = $state.raw<DecisionCardState[]>([]);
  loading = $state(false);
  error = $state(false);
  count = $state(0);
  private generation = 0;
  private watching = false;
  private timer?: ReturnType<typeof setTimeout>;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private request = 0;
  get open() {
    return projectDialog.view === 'decisions';
  }
  set open(value: boolean) {
    projectDialog.view = value ? 'decisions' : 'none';
  }
  activate(project?: { id: string; name: string }) {
    if (!this.watching) {
      this.watching = true;
      window.skaro.on('decisions.changed', ({ projectId }) => {
        if (this.project?.id !== projectId) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.refresh(), 120);
      });
    }
    if (this.project?.id === project?.id) {
      this.project = project;
      return;
    }
    this.generation++;
    clearTimeout(this.timer);
    clearTimeout(this.expiryTimer);
    projectDialog.view = 'none';
    this.project = project;
    this.cards = [];
    this.count = 0;
    this.error = false;
    if (project) void this.refresh();
  }
  async refresh() {
    const project = this.project,
      generation = this.generation,
      request = ++this.request;
    if (!project) return;
    this.loading = !this.cards.length;
    this.error = false;
    try {
      const entries = await window.skaro.invoke('decisions.list', project.id);
      if (generation !== this.generation || request !== this.request) return;
      this.count = entries.length;
      clearTimeout(this.expiryTimer);
      const deadline = Math.min(
        ...entries.flatMap((entry) => (entry.expiresAt ? [entry.expiresAt] : [])),
      );
      if (Number.isFinite(deadline))
        this.expiryTimer = setTimeout(
          () => void this.refresh(),
          Math.max(20, Math.min(2_147_483_647, deadline - Date.now() + 1)),
        );
      const known = new SvelteMap(this.cards.map((card) => [card.entry!.id, card]));
      const next: DecisionCardState[] = entries.map((entry: ProjectDecision) => {
        const card = known.get(entry.id) ?? new DecisionCardState(entry, () => this.refresh());
        card.sync(entry);
        known.delete(entry.id);
        return card;
      });
      if (this.open)
        for (const card of known.values()) {
          card.sync();
          next.push(card);
        }
      this.cards = next;
    } catch {
      if (generation === this.generation && request === this.request) this.error = true;
    } finally {
      if (generation === this.generation && request === this.request) this.loading = false;
    }
  }
  show() {
    this.cards = this.cards.filter(
      (card) =>
        !['answered', 'denied', 'expired'].includes(card.status) &&
        (card.status !== 'stale' || !!card.latest),
    );
    this.open = true;
    void this.refresh();
  }
}
export const decisions = new ProjectDecisions();
