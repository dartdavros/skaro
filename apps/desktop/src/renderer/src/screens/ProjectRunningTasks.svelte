<script lang="ts">
  import { AgentLogo, t } from '@skaro/ui';
  import type { ProjectCard } from '../../../shared/ipc';
  import { agentLine } from './project-card-format';
  let { c }: { c: ProjectCard } = $props();
</script>

<div class="runs">
  {#each c.running.slice(0, 2) as r (r.id)}
    <div class="run">
      <span class="run-dot"></span>
      <span class="run-id">{r.id}</span>
      <span class="run-title">{r.title}</span>
      <span class="run-agent" data-tip={agentLine(r.agent, r.model)}
        ><AgentLogo agent={r.agent} size={13} /></span
      >
    </div>
  {/each}
  {#if c.running.length > 2}
    <div class="more">{t('projects.moreRuns', { n: c.running.length - 2 })}</div>
  {/if}
</div>
