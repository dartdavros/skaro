<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';

  /**
   * Text field: #0f0f0f with a 1px #2a2a2a ring, blue ring on focus. Same look on any surface,
   * placed in a card or modal, never directly on the page background.
   */
  let {
    value = $bindable(''),
    label,
    search = false,
    ...rest
  }: HTMLInputAttributes & { value?: string; label?: string; search?: boolean } = $props();
</script>

{#if label}
  <label class="labeled">
    <span class="sk-label">{label}</span>
    <input class="field" bind:value {...rest} />
  </label>
{:else}
  <div class="wrap">
    {#if search}<span class="icon"><Icon name="search" size={15} stroke={2} color="#989898" /></span
      >{/if}
    <input class="field" class:search bind:value {...rest} />
  </div>
{/if}

<style>
  .labeled {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .wrap {
    position: relative;
  }

  .icon {
    position: absolute;
    left: 10px;
    top: 9px;
    display: inline-flex;
    pointer-events: none;
  }

  .field {
    width: 100%;
    height: 34px;
    padding: 0 11px;
    border: none;
    border-radius: var(--sk-radius);
    background: var(--sk-field);
    color: var(--sk-text-bright);
    font-size: 13px;
    outline: none;
    box-shadow: inset 0 0 0 1px var(--sk-field-ring);
  }

  .field.search {
    height: 33px;
    padding: 0 10px 0 32px;
  }

  .field::placeholder {
    color: #6a6a6a;
  }

  .field:hover {
    background: var(--sk-field-hover);
    box-shadow: inset 0 0 0 1px var(--sk-field-ring-hover);
  }

  .field:focus {
    background: var(--sk-field-hover);
    box-shadow: inset 0 0 0 1px var(--sk-accent);
  }
</style>
