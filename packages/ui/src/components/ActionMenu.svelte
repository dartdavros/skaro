<script lang="ts">
  import { t } from '../i18n.svelte.ts';
  import type { IconName } from '../icons.ts';
  import Icon from './Icon.svelte';
  import Popover from './Popover.svelte';

  /** Actions menu: a list with a separator before the dangerous item. */
  let {
    items,
    tip,
    align = 'left',
    size = 'md',
    width = 214,
  }: {
    items: (
      | { label: string; onselect: () => void; danger?: boolean; icon?: IconName; tip?: string }
      | 'separator'
    )[];
    tip?: string;
    align?: 'left' | 'right';
    /** `sm`: the 26px button of a project card (Projects mockup), `row`: 28px (Plan mockup). */
    size?: 'md' | 'sm' | 'row';
    width?: number;
  } = $props();

  let open = $state(false);
</script>

<Popover bind:open {width} {align} offset={size === 'row' ? 32 : 34}>
  {#snippet trigger({ toggle, open })}
    <button
      type="button"
      class="dots"
      class:active={open}
      class:sm={size === 'sm'}
      class:row={size === 'row'}
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
          data-tip={item.tip}
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
          {#if item.icon}<span class="icon"
              ><Icon name={item.icon} size={14} stroke={item.icon === 'plus' ? 2.4 : 1.9} /></span
            >{/if}
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

  .dots.sm {
    width: 26px;
    height: 26px;
  }

  .dots.row {
    width: 28px;
    height: 28px;
  }

  .dots.active,
  .dots:hover {
    background: var(--sk-fill-22);
    color: var(--sk-text-bright);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 9px;
    border-radius: 6px;
    font-size: var(--sk-fs-6);
    color: var(--sk-text);
    cursor: pointer;
  }

  .item:hover {
    background: var(--sk-menu-hover);
    color: var(--sk-text-bright);
  }

  .icon {
    display: inline-flex;
    color: var(--sk-text-19);
  }

  .item.danger {
    color: var(--sk-red-4);
  }

  .item.danger .icon {
    color: inherit;
  }

  .item.danger:hover {
    background: var(--sk-error-a12);
    color: var(--sk-error);
  }

  .sep {
    height: 1px;
    margin: 4px 2px;
    background: var(--sk-fill-28);
  }
</style>
