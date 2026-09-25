<script lang="ts">
  import { Button, Icon, t } from '@skaro/ui';
  import type { ProjectInfo } from '../../../shared/ipc';

  /** Minimal home until the "Проекты" screen (stage 7): the projects list and "add project". */
  let {
    projects,
    onopen,
    onadd,
  }: { projects: ProjectInfo[]; onopen: (id: string) => void; onadd: () => void } = $props();
</script>

<div class="home">
  <div class="head">
    <div class="titles">
      <h1 class="sk-title">{t('app.home')}</h1>
      <span class="sk-secondary">{t('home.subtitle')}</span>
    </div>
    <Button variant="primary" onclick={onadd}
      ><Icon name="plus" size={15} stroke={2.6} />{t('home.add')}</Button
    >
  </div>
  {#if projects.length === 0}
    <div class="empty sk-text">{t('home.empty')}</div>
  {:else}
    <div class="list">
      {#each projects as project (project.id)}
        <button type="button" class="row" onclick={() => onopen(project.id)}>
          <span class="name">{project.name}</span>
          <span class="path sk-mono">{project.path}</span>
          {#if project.missing}<span class="missing">{t('home.missing')}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .home {
    display: flex;
    flex-direction: column;
    gap: 22px;
    max-width: 880px;
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .empty {
    padding: 18px;
    border-radius: var(--sk-radius-card);
    background: var(--sk-surface);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 12px 14px;
    border: none;
    border-radius: var(--sk-radius-card);
    background: var(--sk-surface);
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background: var(--sk-surface-hover);
  }

  .name {
    font-size: 14.5px;
    font-weight: 600;
    color: var(--sk-text);
  }

  .path {
    flex: 1;
    min-width: 0;
    color: var(--sk-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .missing {
    font-size: 12px;
    color: var(--sk-warn);
  }
</style>
