import { defaultAgent } from '@skaro/agents/catalog';
import type { ProjectCard } from '../../shared/ipc';
import { bootstrap } from './bootstrap';

/** A small cache shared by tab indicators and the first registry viewport. */
class ProjectOverview {
  cards = $state.raw<ProjectCard[]>(
    (bootstrap?.projects ?? []).map(
      (project) =>
        bootstrap?.cards.find((card) => card.id === project.id) ?? {
          ...project,
          unloaded: true,
          refreshing: true,
          activeAt: 0,
          agent: defaultAgent(),
          running: [],
          counts: { working: 0, needs: 0, review: 0, failed: 0, blocked: 0 },
        },
    ),
  );
  private loading?: Promise<void>;
  private listening = false;
  private readonly tabs = new Set(bootstrap?.tabs.projects ?? []);
  load(): Promise<void> {
    if (!this.listening) {
      this.listening = true;
      window.skaro.on('projects.card', (card) => this.remember([card]));
    }
    this.loading ??= window.skaro
      .invoke('projects.query', { query: '', sort: 'attention' })
      .then(({ cards }) => this.remember(cards))
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }
  private remember(incoming: ProjectCard[]): void {
    // A transient merge, published once through cards.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const records = new Map(this.cards.map((card) => [card.id, card]));
    for (const card of incoming) {
      records.delete(card.id);
      records.set(card.id, card);
    }
    for (const id of records.keys()) {
      if (records.size <= 128 + this.tabs.size) break;
      if (!this.tabs.has(id)) records.delete(id);
    }
    this.cards = [...records.values()];
  }
}
export const projectOverview = new ProjectOverview();
