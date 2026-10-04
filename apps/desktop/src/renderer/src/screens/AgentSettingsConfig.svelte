<script lang="ts">
  import { t } from '@skaro/ui';
  import Row from '../settings/Row.svelte';
  import { shortDir, mcpView } from './agent-settings-presentation';
  import type { AgentSettingsCardProps } from './agent-settings-card-props';
  let { a, state }: AgentSettingsCardProps = $props();
  const config = $derived(state.configs[a.id]);
</script>

{#if config}
  <Row>
    {#snippet name()}
      <span data-agents-settings class="cfg-title" data-tip={t('settings.cfg.tip')}
        >{t('settings.cfg')}{#if config.value}&nbsp;·&nbsp;<span
            data-agents-settings
            class="cfg-dir">{shortDir(config.value.dir)}</span
          >{/if}</span
      >
      {#if !a.installed && !config.value}
        <span data-agents-settings class="cfg-note">{t('settings.cfg.notLoaded')}</span>
      {:else if config.failed}
        <span data-agents-settings class="cfg-note">{t('settings.cfg.failed')}</span>
      {:else if !config.value}
        <span data-agents-settings class="cfg-note">{t('agent.state.checking')}</span>
      {:else}
        <span data-agents-settings class="cfg-note cfg-counts"
          >{t('settings.cfg.skills')} · {config.value.skills} · {t('settings.cfg.hooks')} · {config
            .value.hooks}</span
        >
        {#if config.value.mcp.length}
          <div data-agents-settings class="mcp">
            {#each config.value.mcp as server (server.name)}
              {@const v = mcpView(server)}
              <div data-agents-settings class="mcp-row">
                <span
                  data-agents-settings
                  class="mcp-dot"
                  style="background: {v.dot}"
                  data-tip={v.tip}
                ></span>
                <span data-agents-settings class="mcp-name">{server.name}</span>
                <span data-agents-settings class="mcp-meta" style="color: {v.color}">{v.meta}</span>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    {/snippet}
    <button
      data-agents-settings
      type="button"
      class="cfg-open"
      onclick={() => void window.skaro.invoke('agents.openConfigDir', a.id)}
      >{t('settings.cfg.open')}</button
    >
  </Row>
{/if}
