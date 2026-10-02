<script lang="ts">
  import AgentSettingsIdentity from './AgentSettingsIdentity.svelte';
  import AgentSettingsFields from './AgentSettingsFields.svelte';
  import AgentSettingsConfig from './AgentSettingsConfig.svelte';
  import type { AgentSettingsCardProps } from './agent-settings-card-props';
  let { a, state }: AgentSettingsCardProps = $props();
</script>

<div data-agents-settings class="agent">
  <AgentSettingsIdentity {a} {state} />
  <div data-agents-settings class="divider"></div>
  <AgentSettingsFields {a} {state} />
  <AgentSettingsConfig {a} {state} />
</div>
