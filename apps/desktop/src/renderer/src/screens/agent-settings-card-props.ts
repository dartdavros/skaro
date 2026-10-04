import type { AgentInfo } from '../../../shared/ipc';
import type { AgentsSettingsController } from './agents-settings-controller.svelte';
export interface AgentSettingsCardProps {
  a: AgentInfo;
  state: AgentsSettingsController;
}
