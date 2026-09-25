<script lang="ts">
  import type { Snippet } from 'svelte';

  /** Dark checkbox without accent (07 · Поля, чекбоксы, радио). */
  let {
    checked = $bindable(false),
    label,
    tip,
    onchange,
    children,
  }: {
    checked?: boolean;
    label?: string;
    tip?: string;
    onchange?: (checked: boolean) => void;
    children?: Snippet;
  } = $props();

  function toggle(e: MouseEvent): void {
    e.stopPropagation();
    checked = !checked;
    onchange?.(checked);
  }
</script>

<button
  type="button"
  role="checkbox"
  aria-checked={checked}
  class="row"
  class:bare={!label && !children}
  data-tip={tip}
  onclick={toggle}
>
  <span class="box" class:on={checked}>
    {#if checked}
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#ededed"
        stroke-width="3.2"
        stroke-linecap="round"
        stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
      >
    {/if}
  </span>
  {#if children}{@render children()}{:else if label}<span class="label" class:on={checked}
      >{label}</span
    >{/if}
</button>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .box {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--sk-surface);
    box-shadow: inset 0 0 0 1px #353535;
    transition:
      background 0.12s,
      box-shadow 0.12s;
  }

  .box.on {
    background: var(--sk-field-hover);
    box-shadow: inset 0 0 0 1px #5a5a5a;
  }

  .label {
    font-size: 13px;
    color: var(--sk-text-secondary);
  }

  .label.on {
    color: var(--sk-text);
  }
</style>
