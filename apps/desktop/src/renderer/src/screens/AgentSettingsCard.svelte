<script lang="ts">
  import AgentSettingsIdentity from './AgentSettingsIdentity.svelte';
  import AgentSettingsFields from './AgentSettingsFields.svelte';
  import AgentSettingsConfig from './AgentSettingsConfig.svelte';
  import type { AgentSettingsCardProps } from './agent-settings-card-props';
  let { a, state }: AgentSettingsCardProps = $props();
</script>

<div data-agents-settings class="agent set-card">
  <AgentSettingsIdentity {a} {state} />
  <AgentSettingsFields {a} {state} />
  <AgentSettingsConfig {a} {state} />
</div>
