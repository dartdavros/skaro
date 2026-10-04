<script lang="ts">
  import { AgentLogo, t } from '@skaro/ui';
  import type { ProjectCard } from '../../../shared/ipc';
  import { clock } from '../feed/context.svelte';
  import { shortPath, ago, marks, agentLine } from './project-card-format';
  import ProjectAvatar from './ProjectAvatar.svelte';
  let { shown, onopen }: { shown: ProjectCard[]; onopen: (id: string) => void } = $props();
</script>

<div class="table">
  <div class="row head-row">
    <div>{t('projects.col.project')}</div>
    <div>{t('projects.col.milestone')}</div>
    <div>{t('projects.col.statuses')}</div>
    <div>{t('projects.col.agent')}</div>
    <div></div>
  </div>
  {#each shown as c (c.id)}
    <div
      class="row item-row"
      role="button"
      tabindex="0"
      onclick={() => !c.missing && onopen(c.id)}
      onkeydown={(e) => e.key === 'Enter' && !c.missing && onopen(c.id)}
    >
      <div class="cell-project">
        <ProjectAvatar name={c.name} logo={c.logo} small />
        <div class="names">
          <div class="name small">{c.name}</div>
          <div class="path small">{shortPath(c.path)}</div>
        </div>
      </div>
      <div class="cell-ms">
        {#if !c.missing}
          <div class="ms small">
            {#if c.milestone}<span class="ms-id">{c.milestone.id}</span>{/if}
            <span class="ms-name">{c.milestone?.title ?? t('projects.noPlan')}</span>
            {#if c.milestone}<span class="ms-count"
                >{t('projects.ofTotal', {
                  done: c.milestone.done,
                  total: c.milestone.total,
                })}</span
              >{/if}
          </div>
          <div class="bar thin">
            {#if c.milestone}
              {@const pct = Math.round((c.milestone.done / c.milestone.total) * 100)}
              <div
                class="fill"
                style="width: {pct}%; background: {pct === 100
                  ? 'var(--sk-fill-41)'
                  : 'var(--sk-fill-39)'}"
              ></div>
            {/if}
          </div>
        {/if}
      </div>
      <div class="marks">
        {#each marks(c) as m (m.tip)}
          <span class="mark" data-tip={m.tip}
            ><span class="dot" class:pulse={m.pulse} style="background: {m.color}"
            ></span>{m.count}</span
          >
        {/each}
      </div>
      <div
        class="cell-agent"
        data-tip={agentLine(c.agent, c.model)}
        style="color: {c.counts.working ? 'var(--sk-text-11)' : 'var(--sk-text-18)'}"
      >
        <AgentLogo agent={c.agent} size={13} />
      </div>
      <div class="cell-time">{ago(c.activeAt, clock.now)}</div>
    </div>
  {/each}
</div>
