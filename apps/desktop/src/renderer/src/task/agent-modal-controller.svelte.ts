import type { AgentModel } from '@skaro/timeline';
import { t } from '@skaro/ui';
import { untrack } from 'svelte';
import { agentReady, type AgentId, type AgentInfo, type AgentSettings } from '../../../shared/ipc';
export function createAgentModalController(options: {
  projectId: () => string;
  settings: () => AgentSettings;
  open: () => boolean;
  agents: () => AgentInfo[];
  locked: () => boolean;
  close: () => void;
  onsave: (settings: AgentSettings) => Promise<void> | void;
}) {
  // Reset from `options.settings()` each time the modal opens.
  // svelte-ignore state_referenced_locally
  let draft = $state<AgentSettings>(structuredClone($state.snapshot(options.settings())));
  let models = $state<AgentModel[] | undefined>();
  let modelsError = $state(false);
  let saving = $state(false);

  // The draft is taken when the modal opens; later updates (agent status) do not reset choices.
  $effect(() => {
    if (!options.open()) return;
    untrack(() => reset());
  });

  function reset(): void {
    const next = structuredClone($state.snapshot(options.settings()));
    // An absent agent is inactive: a new task or chat opens on a ready one.
    const current = options.agents().find((a) => a.id === next.agent);
    const ready = options.agents().find(agentReady);
    if (!options.locked() && current && !current.installed && ready) {
      next.agent = ready.id;
      delete next.model;
      delete next.effort;
    }
    draft = next;
  }

  const info = $derived(options.agents().find((a) => a.id === draft.agent));

  $effect(() => {
    if (!options.open()) return;
    void loadModels(draft.agent, info?.installed === true);
  });

  async function loadModels(agent: AgentId, installed: boolean): Promise<void> {
    models = undefined;
    modelsError = false;
    if (!installed) return;
    try {
      const list = await window.skaro.invoke('agents.models', agent, options.projectId());
      if (draft.agent === agent) models = list;
    } catch {
      if (draft.agent === agent) modelsError = true;
    }
  }

  const model = $derived(
    models?.find((m) => m.id === draft.model) ?? models?.find((m) => m.isDefault) ?? models?.[0],
  );
  const efforts = $derived(
    (model?.efforts ?? []).map((e) => ({ id: e.id, label: effortLabel(e.id) })),
  );
  const effortDefault = $derived(
    model?.defaultEffort ?? efforts[Math.floor(efforts.length / 2)]?.id,
  );

  function effortLabel(id: string): string {
    const key = `effort.${id}`;
    const text = t(key);
    return text === key ? id : text;
  }

  async function save(): Promise<void> {
    saving = true;
    try {
      const next: AgentSettings = { ...$state.snapshot(draft) };
      if (model) next.model = model.id;
      if (efforts.length && !efforts.some((e) => e.id === next.effort)) {
        if (effortDefault) next.effort = effortDefault;
        else delete next.effort;
      }
      await options.onsave(next);
      options.close();
    } finally {
      saving = false;
    }
  }

  return {
    get draft() {
      return draft;
    },
    get info() {
      return info;
    },
    get models() {
      return models;
    },
    get modelsError() {
      return modelsError;
    },
    get model() {
      return model;
    },
    get efforts() {
      return efforts;
    },
    get effortDefault() {
      return effortDefault;
    },
    get saving() {
      return saving;
    },
    loadModels,
    save,
  };
}
export type AgentModalController = ReturnType<typeof createAgentModalController>;
