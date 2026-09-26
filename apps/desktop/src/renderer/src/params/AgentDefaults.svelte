<script lang="ts">
  import { AgentLogo, EffortSlider, Select, t } from '@skaro/ui';
  import type { AgentId, ProjectSettings } from '../../../shared/ipc';
  import { agents } from '../agents.svelte';
  import { AgentModels, effortLabel } from '../tasks/agent-models.svelte';
  import { AGENT_NAMES } from '../tasks/model';

  /** "Агент по умолчанию" (ProjectSettings mockup): agent, model, effort, permission mode. */
  let {
    projectId,
    settings,
    onchange,
  }: {
    projectId: string;
    settings: ProjectSettings;
    onchange: (patch: Partial<ProjectSettings>) => void;
  } = $props();

  const models = new AgentModels();

  $effect(() => {
    void models.load(settings.defaultAgent, projectId);
  });

  const model = $derived(models.model(settings.defaultModel));
  const effort = $derived(models.effort(model, settings.defaultEffort) ?? '');
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
    if (id === settings.defaultAgent) return;
    onchange({ defaultAgent: id, defaultModel: undefined, defaultEffort: undefined });
  }

  const PERMS = [
    { value: 'ask', warn: false },
    { value: 'auto', warn: false },
    { value: 'full', warn: true },
  ] as const;
</script>

<div class="agents">
  {#each ['claude-code', 'codex'] as const as id (id)}
    {@const on = settings.defaultAgent === id}
    <div
      class="agent"
      class:on
      role="radio"
      aria-checked={on}
      tabindex="0"
      data-tip={on ? t('params.agent.current.tip') : t('params.agent.switch.tip')}
      onclick={() => pickAgent(id)}
      onkeydown={(e) => e.key === 'Enter' && pickAgent(id)}
    >
      <span class="logo"><AgentLogo agent={id} size={21} /></span>
      <div class="names">
        <span class="name">{AGENT_NAMES[id]}</span>
        <span class="state">{agentState(id)}</span>
      </div>
    </div>
  {/each}
</div>

<div class="row">
  <div class="field grow">
    <span class="key">{t('params.model')}</span>
    <div data-tip={t('params.model.tip')}>
      <Select
        width="100%"
        menuWidth="100%"
        label={t('params.model')}
        options={models.list.map((m) => ({
          value: m.id,
          label: m.name,
          description: m.description,
        }))}
        bind:value={
          () => model?.id ?? '',
          (id) =>
            onchange({
              defaultModel: id,
              defaultEffort: models.effort(models.model(id), settings.defaultEffort),
            })
        }
      />
    </div>
  </div>
  {#if levels.length}
    <div class="field effort">
      <span class="key">{t('params.effort')}</span>
      <EffortSlider
        {levels}
        bind:value={() => effort, (e) => onchange({ defaultModel: model?.id, defaultEffort: e })}
        defaultValue={model?.defaultEffort}
      />
    </div>
  {/if}
</div>

<div class="field">
  <span class="key">{t('params.perm')}</span>
  <div class="perms" role="radiogroup">
    {#each PERMS as p (p.value)}
      {@const on = settings.permissionMode === p.value}
      <div
        class="perm"
        class:on
        class:warn={p.warn}
        role="radio"
        aria-checked={on}
        tabindex="0"
        onclick={() => onchange({ permissionMode: p.value })}
        onkeydown={(e) => e.key === 'Enter' && onchange({ permissionMode: p.value })}
      >
        <span class="dot"></span>
        <div class="texts">
          <span class="title">{t(`params.perm.${p.value}`)}</span>
          <span class="note">{t(`params.perm.${p.value}.note`)}</span>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .agents {
    display: flex;
    gap: 9px;
  }

  .agent {
    flex: 1;
    padding: 11px 13px;
    border-radius: 9px;
    background: var(--sk-fill-23);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 11px;
    color: var(--sk-text-19);
    outline: none;
  }

  .agent.on {
    background: var(--sk-fill-11);
    color: var(--sk-text-6);
  }

  .logo {
    flex: none;
    display: inline-flex;
  }

  .names {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .name {
    font-size: var(--sk-fs-6);
    font-weight: 600;
    color: var(--sk-text-13);
  }

  .agent.on .name {
    color: var(--sk-text-6);
  }

  .state {
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
  }

  .row {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .grow {
    flex: 1;
    min-width: 220px;
  }

  .effort {
    flex: 1;
    min-width: 220px;
  }

  .key {
    font-size: var(--sk-fs-3);
    color: var(--sk-text-19);
  }

  .perms {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .perm {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
    outline: none;
  }

  .perm:hover {
    background: var(--sk-fill-20);
  }

  .perm.on {
    background: var(--sk-fill-13);
  }

  .dot {
    flex: none;
    margin-top: 1px;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--sk-fill-34);
  }

  .perm.on .dot {
    background: var(--sk-accent);
    box-shadow: inset 0 0 0 1.5px var(--sk-accent);
  }

  .perm.on.warn .dot {
    background: var(--sk-warn);
    box-shadow: inset 0 0 0 1.5px var(--sk-warn);
  }

  .texts {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .title {
    font-size: var(--sk-fs-5);
    font-weight: 600;
    color: var(--sk-text-13);
  }

  .perm.on .title {
    color: var(--sk-text-6);
  }

  .note {
    font-size: var(--sk-fs-3);
    line-height: 1.45;
    color: var(--sk-text-21);
    text-wrap: pretty;
  }

  .perm.on.warn .note {
    color: var(--sk-orange-2);
  }
</style>
