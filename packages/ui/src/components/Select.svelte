<script lang="ts" generics="T extends string">
  import Popover from './Popover.svelte';
  import SelectOption from './SelectOption.svelte';
  import type { SelectOptionItem } from './select-option.ts';
  import './select.css';

  /**
   * Single select (model select): field background #0f0f0f without a ring, darker than any
   * surface; options may carry an explanation. Not placed directly on the page background.
   * `variant="model"` is the model field of the agent modal (mockup 7a/7b): 34px field, the menu
   * as wide as the field, up to 300px with scrolling, the chosen model marked with a blue check.
   */
  let {
    options,
    value = $bindable(),
    width = 236,
    menuWidth = 264,
    label,
    variant = 'default',
  }: {
    options: SelectOptionItem<T>[];
    value: T;
    width?: number | string;
    menuWidth?: number | string;
    label?: string;
    variant?: 'default' | 'model';
  } = $props();

  let open = $state(false);
  const current = $derived(options.find((o) => o.value === value));
</script>

<div
  data-select
  class:model={variant === 'model'}
  style="width: {typeof width === 'number' ? `${width}px` : width}"
>
  <Popover
    bind:open
    width={variant === 'model' ? '100%' : menuWidth}
    offset={variant === 'model' ? 38 : 36}
    {...variant === 'model' ? { maxHeight: 300 } : {}}
  >
    {#snippet trigger({ toggle })}
      <button
        data-select
        type="button"
        class="field"
        aria-label={label}
        aria-haspopup="listbox"
        onclick={toggle}
      >
        <span data-select class="value">{current?.label ?? ''}</span>
        <svg
          data-select
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--sk-text-22)"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"><path data-select d="m6 9 6 6 6-6" /></svg
        >
      </button>
    {/snippet}
    {#snippet children({ close })}
      {#each options as option (option.value)}
        <SelectOption
          {option}
          selected={option.value === value}
          onpick={() => {
            value = option.value;
            close();
          }}
        />
      {/each}
    {/snippet}
  </Popover>
</div>
