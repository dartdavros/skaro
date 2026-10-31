import { defaultAgent } from '@skaro/agents/catalog';
import type { AgentLimits } from '@skaro/timeline';
import type { AgentId, AgentSettings } from '../../../shared/ipc';

export class LimitsController {
  draft = $state<AgentSettings>({
    agent: defaultAgent(),
    permissionMode: 'ask',
    isolation: 'worktree',
    planFirst: false,
  });
  initialized = $state(false);
  loading = $state(true);
  failed = $state(false);
  snapshot = $state<AgentLimits>();
  private generation = 0;

  async initialize(projectId: string): Promise<void> {
    this.loading = true;
    this.failed = false;
    const generation = this.generation;
    try {
      const settings = await window.skaro.invoke('project.settings', projectId);
      if (generation !== this.generation) return;
      this.draft.agent = settings.defaultAgent;
      this.initialized = true;
    } catch {
      if (generation !== this.generation) return;
      this.loading = false;
      this.failed = true;
    }
  }

  async load(agent: AgentId): Promise<void> {
    const generation = ++this.generation;
    this.loading = true;
    this.failed = false;
    this.snapshot = undefined;
    try {
      const snapshot = await window.skaro.invoke('agents.limits', agent);
      if (generation === this.generation) this.snapshot = snapshot;
    } catch {
      if (generation === this.generation) this.failed = true;
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  cancel(): void {
    this.generation++;
  }
}
