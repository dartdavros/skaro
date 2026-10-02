<script lang="ts">
  import { t } from '@skaro/ui';
  import Section from '../settings/Section.svelte';
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

<Section title={t('settings.agents')} note={t('settings.agents.note')} bare>
  {#each agents as a (a.id)}
    <AgentSettingsCard {a} {state} />
  {/each}
</Section>
