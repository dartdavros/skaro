// Agents as the app sees them: install and sign-in state, kept current by the main process.

import type { AgentInfo } from '../../shared/ipc';

class Agents {
  list = $state<AgentInfo[]>([]);
}

export const agents = new Agents();

export function watchAgents(): void {
  const update = (list: AgentInfo[]): void => {
    agents.list = list;
  };
  void window.skaro.invoke('agents.list').then(update);
  window.skaro.on('agents.changed', update);
}
