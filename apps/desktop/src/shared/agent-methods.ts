import type { AgentCatalogEntry } from '@skaro/agents';
import type { AgentCommand, AgentLimits, AgentModel, AgentUserConfig } from '@skaro/timeline';
import type { AgentId, AgentInfo } from './ipc-entities';

export interface AgentMethods {
  'agents.catalog': () => AgentCatalogEntry[];
  'agents.list': () => AgentInfo[];
  'agents.refresh': () => AgentInfo[];
  'agents.install': (agent: AgentId) => void;
  'agents.login': (agent: AgentId) => void;
  /** `projectId` '' lists models outside a project (Settings). */
  'agents.models': (agent: AgentId, projectId: string) => AgentModel[];
  'agents.commands': (agent: AgentId, projectId: string) => AgentCommand[];
  /** Account quotas; no task/model is started. */
  'agents.limits': (agent: AgentId) => AgentLimits;
  /** "Ваши настройки агента": folder, MCP servers with their state, skills, hooks. */
  'agents.config': (agent: AgentId) => AgentUserConfig;
  'agents.openConfigDir': (agent: AgentId) => void;
}
