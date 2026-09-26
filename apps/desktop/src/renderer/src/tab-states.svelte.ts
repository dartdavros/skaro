// The dot on a project tab (mockups: top bar): an agent works — grey pulse; something waits for
// the user — blue. Kept current from the project cards.

import type { ProjectCard } from '../../shared/ipc';

class TabStates {
  byProject = $state<Record<string, 'working' | 'attention' | 'none'>>({});
}

export const tabStates = new TabStates();

function stateOf(card: ProjectCard): 'working' | 'attention' | 'none' {
  if (card.counts.working > 0) return 'working';
  if (card.counts.needs + card.counts.review > 0) return 'attention';
  return 'none';
}

export function watchTabStates(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const load = async () => {
    const cards = await window.skaro.invoke('projects.overview').catch(() => []);
    tabStates.byProject = Object.fromEntries(cards.map((c) => [c.id, stateOf(c)]));
  };
  void load();
  window.skaro.on('project.changed', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void load(), 400);
  });
}
