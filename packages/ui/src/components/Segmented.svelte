<script lang="ts" generics="T extends string">
  import type { IconName } from '../icons.ts';
  import Icon from './Icon.svelte';

  /**
   * 05 · Переключатель: one look for every mutually exclusive choice. Near-black track,
   * the active item has the main background colour.
   */
  let {
    options,
    value = $bindable(),
    label,
  }: {
    options: { value: T; label: string; icon?: IconName }[];
    value: T;
    label?: string;
  } = $props();
</script>

<div class="track" role="radiogroup" aria-label={label}>
  {#each options as option (option.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === option.value}
      class="item"
      class:active={value === option.value}
      class:icon={!!option.icon}
      data-tip={option.icon ? option.label : undefined}
      aria-label={option.icon ? option.label : undefined}
      onclick={() => (value = option.value)}
    >
      {#if option.icon}
        <Icon name={option.icon} size={14} stroke={2} />
      {:else}
        {option.label}
      {/if}
    </button>
  {/each}
</div>

<style>
  .track {
    display: inline-flex;
    align-self: flex-start;
    width: max-content;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: var(--sk-radius);
    background: var(--sk-seg-track);
  }

  .item {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 27px;
    padding: 0 11px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--sk-icon);
    font-size: 12.5px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }

  .item:hover {
    background: var(--sk-surface);
    color: var(--sk-text);
  }

  .item.active {
    background: var(--sk-bg);
    color: var(--sk-text-bright);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  }

  .item.icon {
    width: 29px;
    padding: 0;
  }
</style>
