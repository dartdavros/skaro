<script lang="ts">
  import type { AgentModel, PermissionMode } from '@skaro/timeline';
  import { AgentLogo, Button, EffortSlider, Modal, RadioCards, Select, t, Toggle } from '@skaro/ui';
  import type { AgentId, AgentInfo, AgentSettings } from '../../../shared/ipc';
  import { agentName } from '../feed/format';

  /**
   * "Агент задачи" (mockup 7a): agent, model and effort from the agent, permission mode,
   * isolation, plan first. Applies to the next request.
   */
  let {
    open = $bindable(false),
    projectId,
    settings,
    agents,
    locked,
    branch,
    sandboxHolds,
    onsave,
  }: {
    open?: boolean;
    projectId: string;
    settings: AgentSettings;
    agents: AgentInfo[];
    /** A started task keeps its agent (sessions are not compatible). */
    locked: boolean;
    branch?: string;
    sandboxHolds?: boolean;
    onsave: (settings: AgentSettings) => Promise<void> | void;
  } = $props();

  // Reset from `settings` each time the modal opens.
  // svelte-ignore state_referenced_locally
  let draft = $state<AgentSettings>(structuredClone($state.snapshot(settings)));
  let models = $state<AgentModel[] | undefined>();
  let modelsError = $state(false);
  let saving = $state(false);

  $effect(() => {
    if (open) draft = structuredClone($state.snapshot(settings));
  });

  const info = $derived(agents.find((a) => a.id === draft.agent));

  $effect(() => {
    if (!open) return;
    void loadModels(draft.agent, info?.installed === true);
  });

  async function loadModels(agent: AgentId, installed: boolean): Promise<void> {
    models = undefined;
    modelsError = false;
    if (!installed) return;
    try {
      const list = await window.skaro.invoke('agents.models', agent, projectId);
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

  function agentState(a: AgentInfo): { text: string; color: string; link?: 'login' } {
    if (a.download) {
      const mb = (n: number) => Math.round(n / 1e6);
      return {
        text: t('agent.state.downloading', {
          a: mb(a.download.received),
          b: mb(a.download.total ?? a.sizeBytes),
        }),
        color: '#8a8a8a',
      };
    }
    if (a.checking) return { text: t('agent.state.checking'), color: '#7d7d7d' };
    if (!a.installed)
      return {
        text: t('agent.state.download', { mb: Math.round(a.sizeBytes / 1e6) }),
        color: '#7d7d7d',
      };
    if (a.authenticated === false)
      return { text: t('agent.state.signin'), color: '#e0a33c', link: 'login' };
    if (a.error) return { text: t('agent.state.error'), color: '#7d7d7d' };
    return { text: t('agent.state.ready'), color: '#7d7d7d' };
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
      await onsave(next);
      open = false;
    } finally {
      saving = false;
    }
  }

  const permOptions = $derived<
    { value: PermissionMode; label: string; note: string; warn?: boolean }[]
  >([
    { value: 'ask', label: t('agent.perm.ask'), note: t('agent.perm.ask.note') },
    {
      value: 'auto',
      label: t('agent.perm.auto'),
      note: sandboxHolds === false ? t('agent.perm.autoNoSandbox.note') : t('agent.perm.auto.note'),
    },
    { value: 'full', label: t('agent.perm.full'), note: t('agent.perm.full.note'), warn: true },
  ]);
  const isoOptions = $derived<{ value: 'worktree' | 'in-place'; label: string; note: string }[]>([
    {
      value: 'worktree',
      label: t('agent.iso.worktree'),
      note: t('agent.iso.worktree.note', { branch: branch ?? 'skaro/…' }),
    },
    { value: 'in-place', label: t('agent.iso.inplace'), note: t('agent.iso.inplace.note') },
  ]);
</script>

<Modal
  bind:open
  title={t('agent.modal.title')}
  subtitle={locked ? t('agent.modal.locked') : t('agent.modal.subtitle')}
>
  <div class="body">
    <div class="agents">
      {#each agents as a (a.id)}
        {@const s = agentState(a)}
        {@const on = draft.agent === a.id}
        {@const disabled = locked && !on}
        <button
          type="button"
          class="agent"
          class:on
          {disabled}
          onclick={() => {
            if (disabled || on) return;
            draft.agent = a.id;
            delete draft.model;
            delete draft.effort;
          }}
        >
          <AgentLogo agent={a.id} size={22} />
          <span class="texts">
            <span class="name">{agentName(a.id)}</span>
            <span class="state" style="color: {s.color}">
              {s.text}
              {#if s.link === 'login'}
                <span
                  class="link"
                  role="button"
                  tabindex="0"
                  onclick={(e) => {
                    e.stopPropagation();
                    void window.skaro.invoke('agents.login', a.id);
                  }}
                  onkeydown={(e) =>
                    e.key === 'Enter' && void window.skaro.invoke('agents.login', a.id)}
                  >{t('agent.login')}</span
                >
              {/if}
            </span>
            {#if a.download}
              <span class="progress"
                ><span
                  style="width: {Math.round(
                    (a.download.received / (a.download.total ?? a.sizeBytes)) * 100,
                  )}%"
                ></span></span
              >
            {/if}
          </span>
        </button>
      {/each}
    </div>

    <div class="section">
      <span class="sk-label">{t('agent.model')}</span>
      {#if models && models.length}
        <div data-tip={t('agent.model.tip')}>
          <Select
            width="100%"
            menuWidth="100%"
            label={t('agent.model')}
            bind:value={() => model?.id ?? '', (v) => (draft.model = v)}
            options={models.map((m) => ({
              value: m.id,
              label: m.name,
              description: m.description,
              ...(m.isDefault ? { tag: t('agent.model.default') } : {}),
            }))}
          />
        </div>
      {:else if modelsError}
        <div class="note error">
          {t('agent.model.error')}
          <button
            type="button"
            class="fd-link-btn"
            onclick={() => void loadModels(draft.agent, true)}>{t('agent.model.retry')}</button
          >
        </div>
      {:else if info?.installed}
        <div class="note">{t('agent.model.loading')}</div>
      {:else}
        <div class="note">{t('agent.model.notInstalled')}</div>
      {/if}
    </div>

    {#if efforts.length > 1}
      <div class="section">
        <span class="sk-label">{t('agent.effort')}</span>
        <EffortSlider
          levels={efforts}
          bind:value={
            () => draft.effort ?? effortDefault ?? efforts[0]!.id, (v) => (draft.effort = v)
          }
          {...effortDefault ? { defaultValue: effortDefault } : {}}
        />
      </div>
    {/if}

    <div class="section">
      <span class="sk-label">{t('agent.perm')}</span>
      <RadioCards options={permOptions} bind:value={draft.permissionMode} label={t('agent.perm')} />
    </div>

    <div class="section">
      <span class="sk-label">{t('agent.iso')}</span>
      <RadioCards options={isoOptions} bind:value={draft.isolation} label={t('agent.iso')} />
    </div>

    <div class="plan-first">
      <span class="texts">
        <span class="name">{t('agent.planFirst')}</span>
        <span class="note-line">{t('agent.planFirst.note')}</span>
      </span>
      <Toggle bind:checked={draft.planFirst} />
    </div>
  </div>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>{t('agent.cancel')}</Button>
    <Button variant="primary" disabled={saving} onclick={() => void save()}
      >{t('agent.save')}</Button
    >
  {/snippet}
</Modal>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 15px;
    max-height: calc(100vh - 220px);
    overflow-y: auto;
    margin: 0 -4px;
    padding: 0 4px;
  }

  .agents {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .agent {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px 13px;
    border: none;
    border-radius: 9px;
    background: transparent;
    cursor: pointer;
    text-align: left;
    font: inherit;
  }

  .agent:hover:not(:disabled) {
    background: #242424;
  }

  .agent.on {
    background: #0d0d0d;
    cursor: default;
  }

  .agent:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .texts {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .name {
    font-size: 13px;
    font-weight: 600;
    color: #d5d5d5;
  }

  .agent:not(.on) .name {
    color: #a6a6a6;
  }

  .state {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
  }

  .link {
    font-weight: 600;
    color: var(--sk-accent);
    cursor: pointer;
  }

  .link:hover {
    color: #2bb3a6;
    text-decoration: underline;
  }

  .progress {
    height: 4px;
    border-radius: 3px;
    background: #242424;
    overflow: hidden;
  }

  .progress span {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: #8a8a8a;
    transition: width 0.6s ease;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .note {
    font-size: 12px;
    color: #7d7d7d;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .note.error {
    color: #ef6a63;
  }

  .plan-first {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 10px;
    background: #242424;
  }

  .note-line {
    font-size: 11.5px;
    color: #7d7d7d;
  }
</style>
