<script lang="ts">
  import { t } from '@skaro/ui';
  import AgentSettingsCard from './AgentSettingsCard.svelte';
  import type { AgentsSettingsProps } from './agents-settings-props';
  import { createAgentsSettingsController } from './agents-settings-controller.svelte';
  let { agents }: AgentsSettingsProps = $props();
  const state = createAgentsSettingsController({
    get agents() {
      return agents;
    },
  });

  import './agents-settings.css';
</script>

<div data-agents-settings class="section">
  <span data-agents-settings class="sk-label">{t('settings.agents')}</span>
  <div data-agents-settings class="agents">
    {#each agents as a (a.id)}
      <AgentSettingsCard {a} {state} />
    {/each}
  </div>
</div>
