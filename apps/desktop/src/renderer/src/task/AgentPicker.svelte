<script lang="ts">
  import { AgentLogo, Icon, t } from '@skaro/ui';
  import type { AgentInfo, AgentSettings } from '../../../shared/ipc';
  import { agentName } from '../feed/format';
  import { agentState } from './agent-status';

  /**
   * Agents as tiles, two in a row: the chosen one is ringed with the accent and checked in the
   * corner; one the task or chat cannot switch to is faded with a lock.
   */
  let { agents, draft, locked }: { agents: AgentInfo[]; draft: AgentSettings; locked: boolean } =
    $props();
</script>

<div class="agents">
  {#each agents as a (a.id)}
    {@const s = agentState(a)}
    {@const on = draft.agent === a.id}
    {@const barred = locked && !on}
    {@const disabled = barred || (!a.installed && !on)}
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
      {#if barred}
        <span class="badge lock"><Icon name="lock" size={9} stroke={2.6} /></span>
      {:else}
        <span class="badge check" class:shown={on}>
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--sk-text-1)"
            stroke-width="3.6"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
          >
        </span>
      {/if}
    </button>
  {/each}
</div>
