<script lang="ts">
  import { AgentLogo, EffortSlider, Select, t } from '@skaro/ui';
  import { AGENT_NAMES } from '../tasks/model';
  import type { AgentDefaultsProps } from './agent-defaults-props';
  import { createAgentDefaultsController } from './agent-defaults-controller.svelte';
  let { projectId, settings, onchange }: AgentDefaultsProps = $props();
  const state = createAgentDefaultsController({
    get projectId() {
      return projectId;
    },
    get settings() {
      return settings;
    },
    get onchange() {
      return onchange;
    },
  });

  import './agent-defaults.css';
</script>

<div data-agent-defaults class="agents">
  {#each ['claude-code', 'codex'] as const as id (id)}
    {@const on = settings.defaultAgent === id}
    <div
      data-agent-defaults
      class="agent"
      class:on
      role="radio"
      aria-checked={on}
      tabindex="0"
      data-tip={on ? t('params.agent.current.tip') : t('params.agent.switch.tip')}
      onclick={() => state.pickAgent(id)}
      onkeydown={(e) => e.key === 'Enter' && state.pickAgent(id)}
    >
      <span data-agent-defaults class="logo"><AgentLogo agent={id} size={21} /></span>
      <div data-agent-defaults class="names">
        <span data-agent-defaults class="name">{AGENT_NAMES[id]}</span>
        <span data-agent-defaults class="state">{state.agentState(id)}</span>
      </div>
    </div>
  {/each}
</div>

<div data-agent-defaults class="row">
  <div data-agent-defaults class="field grow">
    <span data-agent-defaults class="key">{t('params.model')}</span>
    <div data-agent-defaults data-tip={t('params.model.tip')}>
      <Select
        width="100%"
        menuWidth="100%"
        label={t('params.model')}
        options={state.models.list.map((m) => ({
          value: m.id,
          label: m.name,
          description: m.description,
        }))}
        bind:value={
          () => state.model?.id ?? '',
          (id) =>
            onchange({
              defaultModel: id,
              defaultEffort: state.models.effort(state.models.model(id), settings.defaultEffort),
            })
        }
      />
    </div>
  </div>
  {#if state.levels.length}
    <div data-agent-defaults class="field effort">
      <span data-agent-defaults class="key">{t('params.effort')}</span>
      <EffortSlider
        levels={state.levels}
        bind:value={
          () => state.effort, (e) => onchange({ defaultModel: state.model?.id, defaultEffort: e })
        }
        defaultValue={state.model?.defaultEffort}
      />
    </div>
  {/if}
</div>

<div data-agent-defaults class="field">
  <span data-agent-defaults class="key">{t('params.perm')}</span>
  <div data-agent-defaults class="perms" role="radiogroup">
    {#each state.PERMS as p (p.value)}
      {@const on = settings.permissionMode === p.value}
      <div
        data-agent-defaults
        class="perm"
        class:on
        class:warn={p.warn}
        role="radio"
        aria-checked={on}
        tabindex="0"
        onclick={() => onchange({ permissionMode: p.value })}
        onkeydown={(e) => e.key === 'Enter' && onchange({ permissionMode: p.value })}
      >
        <span data-agent-defaults class="dot"></span>
        <div data-agent-defaults class="texts">
          <span data-agent-defaults class="title">{t(`params.perm.${p.value}`)}</span>
          <span data-agent-defaults class="note">{t(`params.perm.${p.value}.note`)}</span>
        </div>
      </div>
    {/each}
  </div>
</div>
