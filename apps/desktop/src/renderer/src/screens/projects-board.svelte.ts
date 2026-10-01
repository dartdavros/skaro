import type { ProjectCard } from '../../../shared/ipc';

export type ProjectSort = 'attention' | 'recent' | 'name';
export type ProjectView = 'grid' | 'list';

export class ProjectsBoardState {
  cards = $state.raw<ProjectCard[]>([]);
  query = $state('');
  sort = $state<ProjectSort>('attention');
  view = $state<ProjectView>('grid');
  loaded = $state(false);
  shown = $derived.by(() => {
    const q = this.query.trim().toLowerCase();
    const list = this.cards.filter((c) => !q || `${c.name} ${c.path}`.toLowerCase().includes(q));
    const score = (c: ProjectCard) =>
      c.counts.needs * 10 + c.counts.review * 5 + c.counts.failed * 3;
    if (this.sort === 'attention')
      return list.toSorted((a, b) => score(b) - score(a) || b.activeAt - a.activeAt);
    if (this.sort === 'recent') return list.toSorted((a, b) => b.activeAt - a.activeAt);
    return list.toSorted((a, b) => a.name.localeCompare(b.name, 'ru'));
  });
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly off: (() => void)[];
  private readonly onchanged: () => void;

  constructor(onchanged: () => void) {
    this.onchanged = onchanged;
    void this.reload();
    void window.skaro.invoke('app.getSetting', 'ui.projects').then((saved) => {
      const s = saved as { sort?: ProjectSort; view?: ProjectView } | null;
      if (s?.sort) this.sort = s.sort;
      if (s?.view) this.view = s.view;
    });
    const soon = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.reload(), 300);
    };
    this.off = [
      window.skaro.on('project.changed', soon),
      window.skaro.on('task.changed', soon),
      window.skaro.on('chats.changed', soon),
    ];
  }
  async reload(): Promise<void> {
    this.cards = await window.skaro.invoke('projects.overview').catch(() => this.cards);
    this.loaded = true;
  }
  remember(): void {
    void window.skaro.invoke('app.setSetting', 'ui.projects', { sort: this.sort, view: this.view });
  }
  async remove(id: string): Promise<void> {
    await window.skaro.invoke('projects.remove', id);
    this.onchanged();
    await this.reload();
  }
  async relocate(card: ProjectCard): Promise<void> {
    const path = await window.skaro.invoke('projects.pickFolder', undefined);
    if (!path) return;
    await window.skaro.invoke('projects.relocate', card.id, path);
    this.onchanged();
    await this.reload();
  }
  dispose(): void {
    clearTimeout(this.timer);
    for (const stop of this.off) stop();
  }
}
