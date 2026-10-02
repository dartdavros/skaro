<script lang="ts">
  import { AgentLogo, t } from '@skaro/ui';
  import { agentName } from '../feed/format';
  import { stateOf } from './agent-settings-presentation';
  import type { AgentSettingsCardProps } from './agent-settings-card-props';
  let { a, state }: AgentSettingsCardProps = $props();
  const s = $derived(stateOf(a));
</script>

<div data-agents-settings class="head">
  <AgentLogo agent={a.id} size={24} />
  <div data-agents-settings class="titles">
    <span data-agents-settings class="name-line"
      ><span data-agents-settings class="name">{agentName(a.id)}</span>{#if a.version}<span
          data-agents-settings
          class="version"
          data-tip={t('settings.agent.version.tip')}>{a.version}</span
        >{/if}</span
    >
    <span data-agents-settings class="state"
      ><span
        data-agents-settings
        class="dot"
        class:pulse={s.pulse}
        style="background: {s.dot}"
        data-tip={s.tip || undefined}
      ></span>{s.text}</span
    >
  </div>
  {#if !a.installed && !a.download && !a.checking}
    <button
      data-agents-settings
      type="button"
      class="btn"
      disabled={state.busy[a.id]}
      onclick={() => void state.run(a.id, () => window.skaro.invoke('agents.install', a.id))}
      >{t('settings.agent.download')}</button
    >
  {/if}
  <button
    data-agents-settings
    type="button"
    class="recheck"
    data-tip={t('settings.agent.recheck')}
    aria-label={t('settings.agent.recheck')}
    onclick={() => {
      state.spin[a.id] = (state.spin[a.id] ?? 0) + 360;
      void window.skaro.invoke('agents.refresh').then(() => state.loadConfig(a.id, a.installed));
    }}
  >
    <svg
      data-agents-settings
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      style="transform: rotate({state.spin[a.id] ?? 0}deg); transition: transform 0.5s"
      ><path data-agents-settings d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"
      ></path><path data-agents-settings d="M21 3v5h-5"></path><path
        data-agents-settings
        d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"
      ></path><path data-agents-settings d="M8 16H3v5"></path></svg
    >
  </button>
</div>
{#if a.download}
  {@const total = a.download.total ?? a.sizeBytes}
  <div data-agents-settings class="progress">
    <div data-agents-settings class="track">
      <div
        data-agents-settings
        class="fill"
        style="width: {Math.min(100, Math.round((a.download.received / total) * 100))}%"
      ></div>
    </div>
    <span data-agents-settings class="progress-text"
      >{Math.round(a.download.received / 1e6)} / {Math.round(total / 1e6)} МБ</span
    >
  </div>
{/if}
