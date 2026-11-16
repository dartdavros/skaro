import { projectOverview } from './project-overview.svelte';
// The dot on a project tab (mockups: top bar): an agent works — grey pulse; something waits for
// the user — blue. Kept current from the project cards.

import { projectTabState } from './project-tab-state';
import { decisions } from './decisions/decisions.svelte';

class TabStates {
  byProject = $state<Record<string, 'working' | 'attention' | 'none'>>({});
}

export const tabStates = new TabStates();

export function watchTabStates(): void {
  void projectOverview.load();
  decisions.watch();
  $effect(() => {
    tabStates.byProject = Object.fromEntries(
      projectOverview.cards.map((card) => [
        card.id,
        projectTabState(card, decisions.counts.get(card.id) ?? 0),
      ]),
    );
  });
}
