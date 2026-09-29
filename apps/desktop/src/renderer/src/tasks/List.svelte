<script lang="ts">
  import { AgentLogo, Checkbox, t } from '@skaro/ui';
  import type { MilestoneInfo, TaskSummary } from '../../../shared/ipc';
  import { agoLong } from '../ago';
  import { agentLine, boardStatus, groups } from './model';
  import StatusLabel from './StatusLabel.svelte';

  /** "Список": tasks grouped by milestone, one row per task (Tasks mockup). */
  let {
    tasks,
    milestones,
    selected,
    now,
    onselect,
    onopen,
  }: {
    tasks: TaskSummary[];
    milestones: MilestoneInfo[];
    selected: string[];
    now: number;
    onselect: (id: string, on: boolean) => void;
    onopen: (id: string) => void;
  } = $props();

  const list = $derived(groups(tasks, milestones, t('board.loose')));
</script>

<div class="list">
  <div class="grid head">
    <div></div>
    <div>{t('board.col.id')}</div>
    <div>{t('board.col.title')}</div>
    <div>{t('board.col.status')}</div>
    <div>{t('board.col.agent')}</div>
    <div>{t('board.col.deps')}</div>
    <div class="right">{t('board.col.updated')}</div>
  </div>
  {#each list as group (group.id)}
    <div class="group">
      <div class="group-head">
        {#if group.id}<span class="ms-id">{group.id}</span>{/if}
        <span class="ms-name">{group.title}</span>
        <span class="ms-count"
          >{t('projects.ofTotal', { done: group.done, total: group.total })}</span
        >
        <div class="line"></div>
      </div>
      <div class="rows">
        {#each group.tasks as task (task.id)}
          {@const on = selected.includes(task.id)}
          {@const kind = boardStatus(task.status)}
          <div
            class="grid row"
            class:selected={on}
            class:dim={kind === 'blocked'}
            role="button"
            tabindex="0"
            data-tip={t('board.open')}
            onclick={() => onopen(task.id)}
            onkeydown={(e) => e.key === 'Enter' && onopen(task.id)}
          >
            <span class="check">
              <Checkbox
                checked={on}
                tip={on ? t('board.unselect') : t('board.select')}
                onchange={(v) => onselect(task.id, v)}
              />
            </span>
            <span class="id">{task.id}</span>
            <span
              class="title"
              class:muted={kind === 'blocked' || kind === 'done' || kind === 'cancelled'}
              >{task.title}</span
            >
            <StatusLabel status={task.status} />
            <span class="agent">
              {#if task.agent}<AgentLogo agent={task.agent} size={10} />{/if}
              <span class="agent-name">{agentLine(task)}</span>
            </span>
            <span class="deps" class:has={task.deps.length > 0}
              >{task.deps.length ? `← ${task.deps.join(', ')}` : '—'}</span
            >
            <span class="updated"
              >{task.status === 'in_progress'
                ? t('agoShort.now')
                : agoLong(task.updatedAt, now)}</span
            >
          </div>
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 24px 18px;
  }

  .grid {
    display: grid;
    grid-template-columns: 26px 62px minmax(0, 1fr) 150px 132px 118px 86px;
    gap: 12px;
  }

  .head {
    padding: 8px 12px;
    font-size: var(--sk-fs-2);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sk-text-21);
  }

  .right {
    text-align: right;
  }

  .group {
    margin-bottom: 14px;
  }

  .group-head {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 12px;
  }

  .ms-id {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    font-weight: 600;
    color: var(--sk-text-17);
  }

  .ms-name {
    font-size: var(--sk-fs-6);
    font-weight: 700;
    color: var(--sk-text-2);
  }

  .ms-count {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
  }

  .line {
    flex: 1;
    height: 1px;
    background: var(--sk-fill-15);
  }

  .rows {
    border-radius: 9px;
    overflow: hidden;
  }

  .row {
    align-items: center;
    padding: 9px 12px;
    background: var(--sk-fill-9);
    border-bottom: 1px solid var(--sk-fill-3);
    cursor: pointer;
    outline: none;
  }

  .row:hover {
    background: var(--sk-fill-18);
  }

  .row.selected {
    background: var(--sk-teal-3);
  }

  .row.dim {
    opacity: 0.72;
  }

  .check {
    display: inline-flex;
  }

  .id {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-17);
  }

  .title {
    min-width: 0;
    font-size: var(--sk-fs-6);
    font-weight: 600;
    color: var(--sk-text-6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title.muted {
    color: var(--sk-text-12);
  }

  .agent {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--sk-fs-3);
    color: var(--sk-text-17);
  }

  .agent-name,
  .deps {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deps {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-2);
    color: var(--sk-text-28);
  }

  .deps.has {
    color: var(--sk-text-13);
  }

  .updated {
    text-align: right;
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
  }
</style>
