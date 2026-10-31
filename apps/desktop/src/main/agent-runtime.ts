import { agentDefinition, createAgentAdapter, type AgentId } from '@skaro/agents';
import type { AgentAdapter, AgentHost } from '@skaro/timeline';

/** A synchronous facade preserves controller contracts without loading an SDK at startup. */
export function lazyAgentAdapter(id: AgentId, host: AgentHost): AgentAdapter {
  const definition = agentDefinition(id);
  let loading: Promise<AgentAdapter> | undefined;
  const runtime = () =>
    (loading ??= createAgentAdapter(id, host).catch((error: unknown) => {
      loading = undefined;
      throw error;
    }));
  return {
    id,
    adapterVersion: definition.adapterVersion,
    status: async () => (await runtime()).status(),
    login: async () => (await runtime()).login(),
    listModels: async (cwd) => (await runtime()).listModels(cwd),
    listCommands: async (cwd) => (await runtime()).listCommands(cwd),
    userConfig: async (cwd) => (await runtime()).userConfig(cwd),
    limits: async (cwd) => (await runtime()).limits(cwd),
    checkSandbox: async (dir) => (await runtime()).checkSandbox(dir),
    start: async (options) => (await runtime()).start(options),
  };
}
