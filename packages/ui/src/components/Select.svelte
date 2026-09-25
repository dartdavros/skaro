<script lang="ts" generics="T extends string">
  import Popover from './Popover.svelte';

  /**
   * Single select (model select): field background #0f0f0f without a ring, darker than any
   * surface; options may carry an explanation. Not placed directly on the page background.
   */
  let {
    options,
    value = $bindable(),
    width = 236,
    menuWidth = 264,
    label,
  }: {
    options: { value: T; label: string; description?: string; tag?: string }[];
    value: T;
    width?: number | string;
    menuWidth?: number | string;
    label?: string;
  } = $props();

  let open = $state(false);
  const current = $derived(options.find((o) => o.value === value));
</script>

<div style="width: {typeof width === 'number' ? `${width}px` : width}">
  <Popover bind:open width={menuWidth} offset={36}>
    {#snippet trigger({ toggle })}
      <button
        type="button"
        class="field"
        aria-label={label}
        aria-haspopup="listbox"
        onclick={toggle}
      >
        <span class="value">{current?.label ?? ''}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#7d7d7d"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg
        >
      </button>
    {/snippet}
    {#snippet children({ close })}
      {#each options as option (option.value)}
        <div
          class="option"
          class:selected={option.value === value}
          role="option"
          aria-selected={option.value === value}
          tabindex="-1"
          onclick={() => {
            value = option.value;
            close();
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              value = option.value;
              close();
            }
          }}
        >
          <span class="check">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.6"
              stroke-linecap="round"
              stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
            >
          </span>
          <div class="texts">
            <span class="name"
              >{option.label}{#if option.tag}<span class="tag">{option.tag}</span>{/if}</span
            >
            {#if option.description}<span class="description">{option.description}</span>{/if}
          </div>
        </div>
      {/each}
    {/snippet}
  </Popover>
</div>

<style>
  .field {
    width: 100%;
    height: 32px;
    padding: 0 11px;
    display: flex;
    align-items: center;
    gap: 8px;
    border: none;
    border-radius: var(--sk-radius);
    background: var(--sk-field);
    color: var(--sk-text);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .field:hover {
    background: var(--sk-field-hover);
  }

  .value {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .option {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 8px 9px;
    border-radius: 7px;
    cursor: pointer;
  }

  .option:hover {
    background: var(--sk-menu-hover);
  }

  .option.selected {
    background: #2b2b2b;
  }

  .check {
    flex: none;
    margin-top: 2px;
    width: 13px;
    display: inline-flex;
    color: transparent;
  }

  .selected .check {
    color: var(--sk-text-bright);
  }

  .texts {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tag {
    margin-left: 8px;
    font-size: 11px;
    font-weight: 600;
    color: var(--sk-text-muted);
  }

  .name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--sk-text);
  }

  .description {
    font-size: 11px;
    line-height: 1.4;
    color: var(--sk-text-muted);
  }
</style>
