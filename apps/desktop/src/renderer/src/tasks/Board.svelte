<script lang="ts">
  import { t } from '@skaro/ui';
  import BoardCard from './BoardCard.svelte';
  import { createBoardDrag } from './board-drag.svelte';
  import type { BoardMoves } from './board-moves-controller.svelte';
  import { COLUMN_ICONS } from './column-icons';
  import './board.css';

  /**
   * "Доска": four status columns, each scrolling on its own (Tasks mockup). Cards are dragged
   * within a column (order) and between columns (start, take back, merge; Skaro UI v2 mockup).
   */
  let {
    moves,
    selected,
    now,
    onselect,
    onopen,
  }: {
    moves: BoardMoves;
    selected: string[];
    now: number;
    onselect: (id: string, on: boolean) => void;
    onopen: (id: string) => void;
  } = $props();

  let root: HTMLDivElement | undefined = $state();
  const dnd = createBoardDrag({
    root: () => root,
    columns: () => moves.columns,
    allowed: (task, from, to) => moves.allowed(task, from, to),
    ondrop: (task, from, to, index) => moves.drop(task, from, to, index),
  });
  const drag = $derived(dnd.drag);
</script>

<div class="board" bind:this={root}>
  {#each moves.columns as col (col.key)}
    {@const items = col.tasks.filter((x) => x.id !== drag?.task.id)}
    {@const slot = drag && drag.to === col.key && drag.allowed ? drag : undefined}
    {@const Icon = COLUMN_ICONS[col.key]}
    <div class="col" class:over={slot && drag?.from !== col.key} data-col={col.key}>
      <div class="head">
        <span class="name" style="color: {col.color}">{t(`board.col.${col.key}`)}</span>
        <span class="count">{items.length + (slot ? 1 : 0)}</span>
      </div>
      <div class="cards" data-scroll>
        {#each items as task, i (task.id)}
          {#if slot && slot.index === i}
            <div class="slot" style="height: {slot.h || 76}px"><span></span></div>
          {/if}
          <BoardCard
            {task}
            {now}
            selected={selected.includes(task.id)}
            dropped={dnd.dropped === task.id}
            onselect={(on) => onselect(task.id, on)}
            onopen={() => onopen(task.id)}
            ondragstart={(e) => dnd.down(task, col.key, e)}
            onkey={(e) => dnd.keydown(task, col.key, e)}
          />
        {/each}
        {#if slot && slot.index >= items.length}
          <div class="slot" style="height: {slot.h || 76}px"><span></span></div>
        {/if}
        {#if !items.length && !slot}
          <div class="empty">
            <span class="empty-icon"><Icon size={18} strokeWidth={1.8} /></span>
            <span class="empty-text">{t(`board.col.${col.key}.empty`)}</span>
          </div>
        {/if}
      </div>
    </div>
  {/each}
  {#if drag && !drag.keyboard}
    <div
      class="col ghost-col"
      style="left: {drag.x - drag.ox}px; top: {drag.y - drag.oy}px; width: {drag.w}px"
    >
      <div class="cards">
        <BoardCard task={drag.task} {now} selected={selected.includes(drag.task.id)} ghost />
      </div>
    </div>
  {/if}
  <div class="live" aria-live="assertive">{dnd.live}</div>
</div>
