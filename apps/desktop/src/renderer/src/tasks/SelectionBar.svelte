<script lang="ts">
  import { Icon, t, tn } from '@skaro/ui';
  import type { TaskSummary } from '../../../shared/ipc';
  import { canStart, type BulkAction } from './model';

  /** The floating bar of a selection (Tasks mockup): run, unblock, assign, move, archive, delete. */
  let {
    selected,
    onaction,
    onclear,
  }: {
    selected: TaskSummary[];
    onaction: (action: BulkAction) => void;
    onclear: () => void;
  } = $props();

  const blocked = $derived(selected.filter((x) => x.status === 'blocked'));
  const canAssign = $derived(selected.every((x) => x.status === 'todo' || x.status === 'blocked'));
  /** Done or running tasks cannot start: "Запустить" only when something would start or wait. */
  const canRun = $derived(blocked.length > 0 || selected.some(canStart));
  /** A done task stays in its milestone. */
  const canMove = $derived(!selected.some((x) => x.status === 'done'));
</script>

<div class="bar">
  <span class="count" data-tip={selected.map((x) => x.id).join(', ')}
    >{t('board.selected', { n: selected.length })}</span
  >
  {#if blocked.length}
    <span class="lock" data-tip={tn('board.sel.blocked', blocked.length)}
      ><Icon name="lock" size={13} stroke={2} /></span
    >
  {/if}
  <div class="sep"></div>
  {#if canRun}
    <button type="button" class="run" data-tip={t('board.run.tip')} onclick={() => onaction('run')}>
      <Icon name="play" size={13} stroke={2} />{t('board.run')}
    </button>
  {/if}
  {#if blocked.length}
    <button
      type="button"
      class="icon"
      data-tip={t('board.unblock')}
      onclick={() => onaction('unblock')}><Icon name="unlock" size={14} stroke={1.9} /></button
    >
  {/if}
  {#if canAssign}
    <button
      type="button"
      class="icon"
      data-tip={t('board.assign')}
      onclick={() => onaction('assign')}><Icon name="code" size={14} stroke={1.9} /></button
    >
  {/if}
  {#if canMove}
    <button type="button" class="icon" data-tip={t('board.move')} onclick={() => onaction('move')}
      ><Icon name="folderPlus" size={14} stroke={1.9} /></button
    >
  {/if}
  <button
    type="button"
    class="icon"
    data-tip={t('board.archive.tip')}
    onclick={() => onaction('archive')}><Icon name="archive" size={14} stroke={1.9} /></button
  >
  <button
    type="button"
    class="icon danger"
    data-tip={t('board.delete.tip')}
    onclick={() => onaction('delete')}><Icon name="trashLines" size={14} stroke={1.9} /></button
  >
  <div class="sep"></div>
  <button type="button" class="clear" data-tip={t('board.clear')} onclick={onclear}
    ><Icon name="close" size={13} stroke={2.2} /></button
  >
</div>

<style>
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 20px;
    z-index: 30;
    width: max-content;
    max-width: calc(100% - 104px);
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px 8px 14px;
    border-radius: 11px;
    background: var(--sk-fill-20);
    box-shadow: 0 18px 44px var(--sk-black-a60);
  }

  .count {
    font-size: var(--sk-fs-6);
    font-weight: 600;
    color: var(--sk-text-2);
    white-space: nowrap;
  }

  .lock {
    display: inline-flex;
    color: var(--sk-text-19);
  }

  .sep {
    width: 1px;
    height: 20px;
    margin: 0 3px;
    background: var(--sk-fill-26);
  }

  button {
    border: none;
    cursor: pointer;
  }

  .run {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border-radius: 8px;
    background: var(--sk-accent);
    color: var(--sk-text-1);
    font-size: var(--sk-fs-5);
    font-weight: 700;
  }

  .run:hover {
    background: var(--sk-accent-hover);
  }

  .icon {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: var(--sk-fill-27);
    color: var(--sk-text-2);
  }

  .icon:hover {
    background: var(--sk-fill-29);
  }

  .icon.danger {
    background: transparent;
    color: var(--sk-red-4);
  }

  .icon.danger:hover {
    background: var(--sk-error-a14);
    color: var(--sk-error);
  }

  .clear {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-text-17);
  }

  .clear:hover {
    background: var(--sk-fill-27);
    color: var(--sk-text-2);
  }
</style>
