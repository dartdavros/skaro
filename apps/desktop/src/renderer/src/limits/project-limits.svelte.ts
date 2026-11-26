import type { AgentId } from '../../../shared/ipc';
import { agents } from '../agents.svelte';
import { lowRemaining } from './low-remaining';
import { watchAccount } from './account-limits.svelte';

/** The sidebar follows the project's default agent independently of the selected chat. */
export class ProjectLimits {
  private agent = $state<AgentId>();
  private account = watchAccount(() => agents.list.find((entry) => entry.id === this.agent));
  snapshot = $derived(this.account.snapshot);
  remaining = $derived(lowRemaining(this.snapshot));
  private generation = 0;
  private readonly stop: () => void;

  constructor(projectId: string) {
    const refresh = async () => {
      const generation = ++this.generation;
      try {
        const settings = await window.skaro.invoke('project.settings', projectId);
        if (generation === this.generation) this.agent = settings.defaultAgent;
      } catch {
        if (generation === this.generation) this.agent = undefined;
      }
    };
    void refresh();
    this.stop = window.skaro.on('project.changed', (event) => {
      if (event.projectId === projectId) void refresh();
    });
  }

  dispose(): void {
    this.generation++;
    this.stop();
  }
}
