<script lang="ts">
  import { AgentLogo, t } from '@skaro/ui';
  import type { AgentInfo, AgentSettings } from '../../../shared/ipc';
  import { agentName } from '../feed/format';
  import { agentState } from './agent-status';
  let { agents, draft, locked }: { agents: AgentInfo[]; draft: AgentSettings; locked: boolean } =
    $props();
</script>

<div class="agents">
  {#each agents as a (a.id)}
    {@const s = agentState(a)}
    {@const on = draft.agent === a.id}
    {@const disabled = (locked && !on) || (!a.installed && !on)}
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
              onkeydown={(e) => e.key === 'Enter' && void window.skaro.invoke('agents.login', a.id)}
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
