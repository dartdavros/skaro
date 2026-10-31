<script lang="ts">
  import { agentPresentation } from '@skaro/agents/catalog';
  import type { AgentId } from '@skaro/agents';
  let { agent, size = 16 }: { agent: AgentId; size?: number } = $props();
  const definition = $derived(agentPresentation(agent));
</script>

<svg
  width={size}
  height={size}
  viewBox={definition.logo.viewBox}
  fill={definition.logo.fill}
  style:color={definition.logo.color}
  aria-label={definition.name}
  role="img"
>
  {#each definition.logo.paths as path (path.d)}
    <path d={path.d} fill={path.fill} fill-rule={path.fillRule} clip-rule={path.clipRule} />
  {/each}
</svg>

<style>
  svg {
    flex: none;
    display: block;
  }
</style>
