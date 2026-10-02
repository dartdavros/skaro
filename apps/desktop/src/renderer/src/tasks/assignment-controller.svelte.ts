import { t } from '@skaro/ui';
import { agentReady, type AgentId, type AgentInfo } from '../../../shared/ipc';
import { agents } from '../agents.svelte';
import { AgentModels, effortLabel } from './agent-models.svelte';
import type { AssignmentProps } from './assignment-props';

export function createAssignmentController(p: AssignmentProps) {
  let agent = $state<AgentId>(agents.list.find(agentReady)?.id ?? 'claude-code');
  let modelId = $state('');
  let effort = $state('');
  const models = new AgentModels();

  $effect(() => {
    const id = agent;
    void models.load(id, p.projectId).then(() => {
      modelId = models.model()?.id ?? '';
      effort = models.effort(models.model()) ?? '';
    });
  });

  const model = $derived(models.model(modelId));
  const levels = $derived(
    (model?.efforts ?? []).map((e) => ({ id: e.id, label: effortLabel(e.id) })),
  );
  const note = $derived.by(() => {
    const key = `board.as.effort.${effort}`;
    const text = t(key);
    return text === key ? '' : text;
  });

  function agentState(info: AgentInfo | undefined): string {
    if (!info) return '';
    if (agentReady(info)) return t('board.as.ready');
    if (!info.installed) return t('settings.agent.notLoaded.tip');
    return t('settings.agent.signedOut');
  }

  function pick(id: AgentId): void {
    if (id === agent) return;
    agent = id;
    modelId = '';
  }

  function onmodel(id: string): void {
    modelId = id;
    effort = models.effort(models.model(id), effort) ?? '';
  }

  return {
    p,
    get agent() {
      return agent;
    },
    get modelId() {
      return modelId;
    },
    get effort() {
      return effort;
    },
    set effort(value: typeof effort) {
      effort = value;
    },
    get models() {
      return models;
    },
    get model() {
      return model;
    },
    get levels() {
      return levels;
    },
    get note() {
      return note;
    },
    agentState,
    pick,
    onmodel,
  };
}

export type AssignmentController = ReturnType<typeof createAssignmentController>;
