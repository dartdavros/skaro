// Agents as the app sees them: install and sign-in state, kept current by the main process.

import { agentReady, type AgentInfo } from '../../shared/ipc';

class Agents {
  list = $state<AgentInfo[]>([]);
  /** No agent can take work: Skaro lets the user do nothing but add one. */
  none = $derived(
    this.list.length > 0 && !this.list.some((a) => a.checking) && !this.list.some(agentReady),
  );
  /** The user closed the "агент не найден" banner (until the app restarts). */
  bannerHidden = $state(false);
}

export const agents = new Agents();

export function watchAgents(): void {
  const update = (list: AgentInfo[]): void => {
    agents.list = list;
  };
  void window.skaro.invoke('agents.list').then(update);
  window.skaro.on('agents.changed', update);
}
