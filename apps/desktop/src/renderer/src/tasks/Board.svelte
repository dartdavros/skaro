<script lang="ts">
  import { t } from '@skaro/ui';
  import type { TaskSummary } from '../../../shared/ipc';
  import BoardCard from './BoardCard.svelte';
  import { columns } from './model';

  /** "Доска": four status columns, each scrolling on its own (Tasks mockup). */
  let {
    tasks,
    selected,
    now,
    onselect,
    onopen,
  }: {
    tasks: TaskSummary[];
    selected: string[];
    now: number;
    onselect: (id: string, on: boolean) => void;
    onopen: (id: string) => void;
  } = $props();

  const cols = $derived(columns(tasks));
</script>

<div class="board">
  {#each cols as col (col.key)}
    <div class="col">
      <div class="head">
        <span class="name" style="color: {col.color}">{t(`board.col.${col.key}`)}</span>
        <span class="count">{col.tasks.length}</span>
      </div>
      <div class="cards">
        {#each col.tasks as task (task.id)}
          <BoardCard
            {task}
            {now}
            selected={selected.includes(task.id)}
            onselect={(on) => onselect(task.id, on)}
            onopen={() => onopen(task.id)}
          />
        {:else}
          <div class="empty">{t(`board.col.${col.key}.empty`)}</div>
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .board {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    padding: 4px 24px 18px;
  }

  .col {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    background: var(--sk-deep);
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px 8px;
  }

  .name {
    font-size: var(--sk-fs-4);
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .count {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
  }

  .cards {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .empty {
    padding: 14px 10px;
    border-radius: 8px;
    background: var(--sk-fill-3);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
    text-align: center;
    text-wrap: pretty;
  }
</style>
