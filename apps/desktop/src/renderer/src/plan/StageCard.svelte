<script lang="ts">
  import { ActionMenu, Icon, t } from '@skaro/ui';
  import type { TaskSummary } from '../../../shared/ipc';
  import { doneLike, rowStatus, type Drag, type Over, type Stage } from './model';
  import TaskRow from './TaskRow.svelte';

  /** A milestone of the plan (Plan mockup): header with marks and progress, goal, tasks. */
  let {
    stage,
    index,
    open,
    hideDone,
    hovered,
    up,
    down,
    byId,
    drag,
    over,
    now,
    ontoggle,
    onmenu,
    onhover,
    onopen,
    ondrag,
    onover,
    ondrop,
  }: {
    stage: Stage;
    index: number;
    open: boolean;
    hideDone: boolean;
    hovered?: string;
    up: Set<string>;
    down: Set<string>;
    byId: Map<string, TaskSummary>;
    drag?: Drag;
    over?: Over;
    now: number;
    ontoggle: () => void;
    onmenu: (action: 'newTask' | 'edit' | 'discuss' | 'delete') => void;
    onhover: (id: string | undefined) => void;
    onopen: (taskId: string) => void;
    ondrag: (drag: Drag | undefined) => void;
    onover: (over: Over) => void;
    ondrop: () => void;
  } = $props();

  const m = $derived(stage.milestone);
  const shown = $derived(stage.tasks.filter((x) => !(hideDone && doneLike(rowStatus(x.status)))));
  const pct = $derived(stage.total ? Math.round((stage.done / stage.total) * 100) : 0);
  const finished = $derived(stage.total > 0 && stage.done === stage.total);
  const end = $derived(stage.tasks.length);
  const endOver = $derived(
    drag?.kind === 'task' && over?.kind === 'task' && over.stage === m.id && over.index === end,
  );
  const stageOver = $derived(
    drag?.kind === 'stage' && over?.kind === 'stage' && over.index === index && drag.id !== m.id,
  );

  function start(e: DragEvent, next: Drag): void {
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', next.id);
    }
    ondrag(next);
  }

  function overStage(e: DragEvent): void {
    if (!drag) return;
    e.preventDefault();
    onover(
      drag.kind === 'stage' ? { kind: 'stage', index } : { kind: 'task', stage: m.id, index: end },
    );
  }

  function overEnd(e: DragEvent): void {
    if (drag?.kind !== 'task') return;
    e.preventDefault();
    e.stopPropagation();
    onover({ kind: 'task', stage: m.id, index: end });
  }

  function relation(task: TaskSummary): 'up' | 'down' | 'self' | undefined {
    if (hovered === task.id) return 'self';
    return up.has(task.id) ? 'up' : down.has(task.id) ? 'down' : undefined;
  }
</script>

<div
  class="stage"
  class:ring={stageOver}
  class:dragged={drag?.kind === 'stage' && drag.id === m.id}
  role="listitem"
  ondragover={overStage}
  ondrop={(e) => {
    e.preventDefault();
    ondrop();
  }}
>
  <div
    class="head"
    role="button"
    tabindex="0"
    draggable={!stage.loose}
    onclick={ontoggle}
    onkeydown={(e) => e.key === 'Enter' && ontoggle()}
    ondragstart={(e) => !stage.loose && start(e, { kind: 'stage', id: m.id })}
    ondragend={() => ondrag(undefined)}
  >
    {#if stage.loose}
      <span class="grip-space"></span>
    {:else}
      <span class="grip" data-tip={t('plan.dragStage')}
        ><Icon name="grip" size={14} stroke={2} /></span
      >
    {/if}
    <span class="chev" class:open><Icon name="chevronRight" size={14} stroke={2.2} /></span>
    <span class="id">{m.id}</span>
    <span class="name" class:finished>{m.title}</span>
    <div class="marks">
      {#if stage.working}
        <span class="mark" data-tip={t('plan.mark.working', { n: stage.working })}
          ><span class="dot working"></span>{stage.working}</span
        >
      {/if}
      {#if stage.attention}
        <span class="mark" data-tip={t('plan.mark.attention', { n: stage.attention })}
          ><span class="dot"></span>{stage.attention}</span
        >
      {/if}
      {#if stage.errors}
        <span class="mark" data-tip={t('plan.mark.error', { n: stage.errors })}
          ><span class="dot error"></span>{stage.errors}</span
        >
      {/if}
    </div>
    <div
      class="progress"
      data-tip={pct === 100
        ? t('plan.progress.done')
        : t('plan.progress.tip', { done: stage.done, total: stage.total })}
    >
      <div class="track">
        <div class="fill" class:full={pct === 100} style="width: {pct}%"></div>
      </div>
      <span class="count">{t('plan.progress', { done: stage.done, total: stage.total })}</span>
    </div>
    <!-- The menu does not toggle the milestone. -->
    {#if stage.loose}
      <span class="menu-space"></span>
    {:else}
      <div class="menu" role="presentation" onclick={(e) => e.stopPropagation()}>
        <ActionMenu
          size="row"
          align="right"
          width={222}
          tip={t('plan.menu')}
          items={[
            {
              label: t('plan.menu.newTask'),
              icon: 'plus',
              tip: t('plan.menu.newTask.tip'),
              onselect: () => onmenu('newTask'),
            },
            { label: t('plan.menu.edit'), icon: 'edit', onselect: () => onmenu('edit') },
            { label: t('plan.discuss'), icon: 'chat', onselect: () => onmenu('discuss') },
            'separator',
            {
              label: t('plan.menu.delete'),
              icon: 'trashRound',
              danger: true,
              onselect: () => onmenu('delete'),
            },
          ]}
        />
      </div>
    {/if}
  </div>

  {#if open}
    <div class="body">
      {#if m.goal || m.criteria}
        <div class="meta">
          <div class="meta-col">
            <span class="label">{t('plan.goal')}</span>
            <span class="text">{m.goal ?? ''}</span>
          </div>
          <div class="meta-col">
            <span class="label">{t('plan.criteria')}</span>
            <span class="text">{m.criteria ?? ''}</span>
          </div>
        </div>
      {/if}
      <div class="rows" role="list">
        {#each shown as task (task.id)}
          {@const at = stage.tasks.indexOf(task)}
          <TaskRow
            {task}
            {byId}
            {now}
            relation={relation(task)}
            faded={!!hovered && hovered !== task.id && !up.has(task.id) && !down.has(task.id)}
            dragged={drag?.kind === 'task' && drag.id === task.id}
            dropLine={drag?.kind === 'task' &&
              drag.id !== task.id &&
              over?.kind === 'task' &&
              over.stage === m.id &&
              over.index === at}
            onenter={() => !drag && onhover(task.id)}
            onleave={() => onhover(undefined)}
            onopen={() => onopen(task.id)}
            ondragstart={(e) => {
              onhover(undefined);
              start(e, { kind: 'task', id: task.id });
            }}
            ondragover={(e) => {
              if (drag?.kind !== 'task') return;
              e.preventDefault();
              e.stopPropagation();
              onover({ kind: 'task', stage: m.id, index: at });
            }}
            ondrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              ondrop();
            }}
            ondragend={() => ondrag(undefined)}
          />
        {/each}
        {#if !shown.length}
          <div class="empty" class:drop={endOver} role="presentation" ondragover={overEnd}>
            {stage.tasks.length
              ? t('plan.allDone', { n: stage.tasks.length - shown.length })
              : t('plan.empty.stage')}
          </div>
        {/if}
        <div
          class="end"
          class:drop={endOver && shown.length > 0}
          role="presentation"
          ondragover={overEnd}
        ></div>
      </div>
    </div>
  {/if}
</div>

<style>
  .stage {
    flex: none;
    border-radius: 10px;
    background: var(--sk-fill-11);
    transition: box-shadow 0.12s;
  }

  .stage.ring {
    box-shadow: inset 0 2px 0 var(--sk-accent);
  }

  .stage.dragged {
    opacity: 0.45;
  }

  .head {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 10px 12px 8px;
    border-radius: 10px;
    cursor: pointer;
    outline: none;
  }

  .head:hover {
    background: var(--sk-fill-15);
  }

  .grip {
    flex: none;
    width: 14px;
    display: inline-flex;
    justify-content: center;
    color: var(--sk-text-28);
    cursor: grab;
  }

  .grip-space {
    flex: none;
    width: 14px;
  }

  .menu-space {
    flex: none;
    width: 28px;
  }

  .chev {
    flex: none;
    display: inline-flex;
    color: var(--sk-text-21);
    transition: transform 0.15s;
  }

  .chev.open {
    transform: rotate(90deg);
  }

  .id {
    flex: none;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    font-weight: 600;
    color: var(--sk-text-14);
  }

  .name {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-8);
    font-weight: 600;
    color: var(--sk-text-6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name.finished {
    color: var(--sk-text-13);
  }

  .marks {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .mark {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    color: var(--sk-text-13);
    cursor: default;
  }

  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--sk-accent);
  }

  .dot.working {
    background: var(--sk-fill-41);
    animation: skPulse 1.6s ease-in-out infinite;
  }

  .dot.error {
    background: var(--sk-error);
  }

  .progress {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 176px;
  }

  .track {
    flex: 1;
    height: 4px;
    border-radius: 3px;
    background: var(--sk-fill-20);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: 3px;
    background: var(--sk-fill-39);
    transition: width 0.3s ease;
  }

  .fill.full {
    background: var(--sk-fill-41);
  }

  .count {
    flex: none;
    width: 44px;
    text-align: right;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-17);
  }

  .menu {
    flex: none;
  }

  .body {
    padding: 0 10px 10px 8px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .meta {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 20px;
    padding: 2px 10px 4px 46px;
  }

  .meta-col {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .label {
    font-size: var(--sk-fs-2);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--sk-text-23);
  }

  .text {
    font-size: var(--sk-fs-6);
    line-height: 1.55;
    color: var(--sk-text-10);
    text-wrap: pretty;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .empty {
    height: 38px;
    display: flex;
    align-items: center;
    padding-left: 46px;
    border-radius: 8px;
    font-size: var(--sk-fs-5);
    color: var(--sk-text-23);
  }

  .end {
    height: 6px;
    border-radius: 3px;
  }

  .empty.drop,
  .end.drop {
    box-shadow: inset 0 2px 0 var(--sk-accent);
  }
</style>
