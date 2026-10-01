<script lang="ts">
  import { ActionMenu, Icon, t } from '@skaro/ui';
  import type { ProjectCard } from '../../../shared/ipc';
  import { clock } from '../feed/context.svelte';
  import { shortPath, ago, marks } from './project-card-format';
  import ProjectAvatar from './ProjectAvatar.svelte';
  import ProjectMissing from './ProjectMissing.svelte';
  import ProjectRunningTasks from './ProjectRunningTasks.svelte';
  let {
    c,
    onopen,
    relocate,
    remove,
  }: {
    c: ProjectCard;
    onopen: (id: string) => void;
    relocate: (card: ProjectCard) => Promise<void>;
    remove: (id: string) => Promise<void>;
  } = $props();
  function menu(c: ProjectCard) {
    return [
      {
        label: t('projects.menu.explorer'),
        onselect: () => void window.skaro.invoke('projects.openIn', c.id, 'explorer'),
      },
      {
        label: t('projects.menu.terminal'),
        onselect: () => void window.skaro.invoke('projects.openIn', c.id, 'terminal'),
      },
      {
        label: t('projects.menu.editor'),
        onselect: () => void window.skaro.invoke('projects.openIn', c.id, 'editor'),
      },
      'separator' as const,
      { label: t('projects.remove'), danger: true, onselect: () => void remove(c.id) },
    ];
  }
</script>

<div
  class="card"
  role="button"
  tabindex="0"
  onclick={() => !c.missing && onopen(c.id)}
  onkeydown={(e) => e.key === 'Enter' && !c.missing && onopen(c.id)}
>
  <div class="card-body">
    <div class="top">
      <ProjectAvatar name={c.name} logo={c.logo} />
      <div class="names">
        <div class="name">{c.name}</div>
        <div class="path" data-tip={c.path}>{shortPath(c.path)}</div>
      </div>
      <!-- The menu opens over the card; clicks there do not open the project. -->
      <div
        role="presentation"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <ActionMenu size="sm" align="right" items={menu(c)} />
      </div>
    </div>

    {#if c.missing}
      <ProjectMissing {c} {relocate} {remove} />
    {:else}
      <div class="ok">
        {#if marks(c).length}
          <div class="marks">
            {#each marks(c) as m (m.tip)}
              <span class="mark" data-tip={m.tip}
                ><span class="dot" class:pulse={m.pulse} style="background: {m.color}"
                ></span>{m.count}</span
              >
            {/each}
          </div>
        {/if}
        <div>
          <div class="ms">
            {#if c.milestone}<span class="ms-id">{c.milestone.id}</span>{/if}
            <span class="ms-name">{c.milestone?.title ?? t('projects.noPlan')}</span>
            {#if c.milestone}<span class="ms-count"
                >{t('projects.ofTotal', {
                  done: c.milestone.done,
                  total: c.milestone.total,
                })}</span
              >{/if}
          </div>
          <div class="bar">
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
        </div>
        {#if c.running.length}
          <ProjectRunningTasks {c} />
        {/if}
      </div>
    {/if}

    <div class="foot">
      <span class="activity">{ago(c.activeAt, clock.now)}</span>
      {#if c.branch || c.missing}
        <span class="branch"><Icon name="branch" size={12} stroke={1.9} />{c.branch ?? '—'}</span>
      {/if}
    </div>
  </div>
</div>
