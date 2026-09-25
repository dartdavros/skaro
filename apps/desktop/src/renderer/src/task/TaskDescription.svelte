<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { TaskDetail } from '../../../shared/ipc';
  import StatusChip from './StatusChip.svelte';

  /** Left panel of the task screen: breadcrumbs, status, links, goal, criteria, notes. */
  let {
    task,
    oncollapse,
    ontasks,
    ontoggle,
  }: {
    task: TaskDetail;
    oncollapse: () => void;
    ontasks: () => void;
    ontoggle: (index: number) => void;
  } = $props();
</script>

<div class="desc">
  <div class="crumbs">
    <button type="button" class="crumb" data-tip={t('task.crumbs.tasks.tip')} onclick={ontasks}
      >{t('task.crumbs.tasks')}</button
    >
    {#if task.milestone}
      <span class="slash">/</span>
      <span class="crumb static">{task.milestone.id} · {task.milestone.title}</span>
    {/if}
    <span class="slash">/</span>
    <span class="id">{task.id}</span>
  </div>
  <div class="title-row">
    <h1>{task.title}</h1>
    <button
      type="button"
      class="collapse"
      data-tip={t('task.collapse')}
      aria-label={t('task.collapse')}
      onclick={oncollapse}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M9 4v16"></path><path
          d="m6.4 10.6-1.4 1.4 1.4 1.4"
        ></path></svg
      >
    </button>
  </div>

  <div class="meta">
    <StatusChip status={task.status} />
    {#if task.dependsOn.length}
      <div class="line">
        {t('task.dependsOn')}
        {#each task.dependsOn as dep (dep.id)}
          <span class="ref" data-tip={`${dep.title} · ${t(`task.status.${dep.status}`)}`}>
            {#if dep.status === 'done'}<Icon name="check" size={11} stroke={2.4} />{/if}{dep.id}
          </span>
        {/each}
      </div>
    {/if}
    {#if task.blocks.length}
      <div class="line">
        {t('task.blocks')}
        {#each task.blocks as ref (ref.id)}
          <span class="ref" data-tip={ref.title}>{ref.id}</span>
        {/each}
      </div>
    {/if}
    {#if task.branch}
      <div class="branch" data-tip={t('task.branch.tip')}>
        <Icon name="branch" size={12} stroke={1.9} />
        <span>{task.branch}</span>
      </div>
    {/if}
  </div>

  <div class="sep"></div>

  {#if task.goal}
    <div class="section">
      <span class="sk-label">{t('task.goal')}</span>
      <p class="goal">{task.goal}</p>
    </div>
  {/if}

  {#if task.criteria.length}
    <div class="section" style="gap: 9px">
      <span class="sk-label">{t('task.criteria')}</span>
      <div class="criteria">
        {#each task.criteria as criterion, i (i)}
          <button type="button" class="criterion" onclick={() => ontoggle(i)}>
            <span class="box" class:done={criterion.done}>
              {#if criterion.done}<Icon name="check" size={11} stroke={3.2} color="#ededed" />{/if}
            </span>
            <span class="text" class:done={criterion.done}>{criterion.text}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if task.notes}
    <div class="section">
      <span class="sk-label">{t('task.notes')}</span>
      <p class="notes">{task.notes}</p>
    </div>
  {/if}

  {#if task.summary}
    <div class="section">
      <span class="sk-label">{t('task.summary')}</span>
      <p class="notes">{task.summary}</p>
    </div>
  {/if}
</div>

<style>
  .desc {
    display: flex;
    flex-direction: column;
    gap: 15px;
    padding: 10px 14px 12px 16px;
  }

  .crumbs {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: #7d7d7d;
    min-width: 0;
  }

  .crumb {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
  }

  .crumb:hover {
    color: #d5d5d5;
  }

  .crumb.static {
    cursor: default;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .crumb.static:hover {
    color: inherit;
  }

  .slash {
    color: #4a4a4a;
  }

  .id {
    font-family: var(--sk-mono);
    color: #a6a6a6;
  }

  .title-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  h1 {
    flex: 1;
    margin: 0;
    font-size: 17px;
    font-weight: 700;
    line-height: 1.35;
    color: #d8d8d8;
    text-wrap: pretty;
  }

  .collapse {
    flex: none;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #6f6f6f;
    cursor: pointer;
    padding: 0;
  }

  .collapse:hover {
    background: #1c1c1c;
    color: #d5d5d5;
  }

  .meta {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
    color: #8a8a8a;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
  }

  .ref {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--sk-mono);
    color: #a6a6a6;
  }

  .branch {
    display: flex;
    align-items: center;
    gap: 7px;
    font-family: var(--sk-mono);
    color: #e8875b;
    min-width: 0;
  }

  .branch span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sep {
    height: 1px;
    background: #191919;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .goal {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: #b1b1b1;
    text-wrap: pretty;
    white-space: pre-wrap;
  }

  .notes {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.6;
    color: #8a8a8a;
    text-wrap: pretty;
    white-space: pre-wrap;
  }

  .criteria {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .criterion {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 0;
    border: none;
    background: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }

  .box {
    flex: none;
    margin-top: 1px;
    width: 16px;
    height: 16px;
    border-radius: 5px;
    background: #1a1a1a;
    box-shadow: inset 0 0 0 1px #353535;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .box.done {
    background: #0b0b0b;
    box-shadow: inset 0 0 0 1px #5a5a5a;
  }

  .criterion .text {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: #a6a6a6;
    text-wrap: pretty;
  }

  .criterion .text.done {
    color: #7d7d7d;
  }
</style>
