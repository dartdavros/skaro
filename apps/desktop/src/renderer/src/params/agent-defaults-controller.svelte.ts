import { t } from '@skaro/ui';
import type { AgentId } from '../../../shared/ipc';
import { agents } from '../agents.svelte';
import { AgentModels, effortLabel } from '../tasks/agent-models.svelte';
import type { AgentDefaultsProps } from './agent-defaults-props';
export function createAgentDefaultsController(p: AgentDefaultsProps) {
  const models = new AgentModels();

  $effect(() => {
    void models.load(p.settings.defaultAgent, p.projectId);
  });

  const model = $derived(models.model(p.settings.defaultModel));
  const effort = $derived(models.effort(model, p.settings.defaultEffort) ?? '');
  const levels = $derived(
    (model?.efforts ?? []).map((e) => ({ id: e.id, label: effortLabel(e.id) })),
  );

  function agentState(id: AgentId): string {
    const info = agents.list.find((a) => a.id === id);
    return info?.installed
      ? t('params.agent.installed', { version: info.version ?? '' })
      : t('params.agent.notInstalled');
  }

  function pickAgent(id: AgentId): void {
    if (id === p.settings.defaultAgent) return;
    p.onchange({ defaultAgent: id, defaultModel: undefined, defaultEffort: undefined });
  }

  const PERMS = [
    { value: 'ask', warn: false },
    { value: 'auto', warn: false },
    { value: 'full', warn: true },
  ] as const;

  return {
    p,
    get models() {
      return models;
    },
    get model() {
      return model;
    },
    get effort() {
      return effort;
    },
    get levels() {
      return levels;
    },
    get PERMS() {
      return PERMS;
    },
    agentState,
    pickAgent,
  };
}
export type AgentDefaultsController = ReturnType<typeof createAgentDefaultsController>;
