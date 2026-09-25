<script lang="ts">
  import { t } from '../i18n.svelte.ts';
  import Popover from './Popover.svelte';

  /** Actions menu: a list with a separator before the dangerous item. */
  let {
    items,
    tip,
    align = 'left',
  }: {
    items: ({ label: string; onselect: () => void; danger?: boolean } | 'separator')[];
    tip?: string;
    align?: 'left' | 'right';
  } = $props();

  let open = $state(false);
</script>

<Popover bind:open width={214} {align}>
  {#snippet trigger({ toggle, open })}
    <button
      type="button"
      class="dots"
      class:active={open}
      data-tip={tip ?? t('ui.more')}
      aria-label={tip ?? t('ui.more')}
      onclick={toggle}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"
        ><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle
          cx="19"
          cy="12"
          r="1.8"
        /></svg
      >
    </button>
  {/snippet}
  {#snippet children({ close })}
    {#each items as item, i (i)}
      {#if item === 'separator'}
        <div class="sep"></div>
      {:else}
        <div
          class="item"
          class:danger={item.danger}
          role="menuitem"
          tabindex="-1"
          onclick={() => {
            close();
            item.onselect();
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              close();
              item.onselect();
            }
          }}
        >
          {item.label}
        </div>
      {/if}
    {/each}
  {/snippet}
</Popover>

<style>
  .dots {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-icon);
    cursor: pointer;
  }

  .dots.active,
  .dots:hover {
    background: #262626;
    color: var(--sk-text-bright);
  }

  .item {
    padding: 7px 9px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--sk-text);
    cursor: pointer;
  }

  .item:hover {
    background: var(--sk-menu-hover);
    color: var(--sk-text-bright);
  }

  .item.danger {
    color: #d98079;
  }

  .item.danger:hover {
    background: rgba(239, 106, 99, 0.12);
    color: var(--sk-error);
  }

  .sep {
    height: 1px;
    margin: 4px 2px;
    background: #2f2f2f;
  }
</style>
