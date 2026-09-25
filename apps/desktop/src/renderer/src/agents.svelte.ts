// Agents as the app sees them: install and sign-in state, kept current by the main process.

import type { AgentInfo } from '../../shared/ipc';

class Agents {
  list = $state<AgentInfo[]>([]);
}

export const agents = new Agents();

export function watchAgents(): void {
  void window.skaro.invoke('agents.list').then((list) => (agents.list = list));
  window.skaro.on('agents.changed', (list) => (agents.list = list));
}
