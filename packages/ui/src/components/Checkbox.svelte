<script lang="ts">
  import type { Snippet } from 'svelte';

  /** Checkbox: an empty ring, filled with the accent when on (07 · Поля, чекбоксы, радио). */
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
    <!-- Always rendered: the check scales in and out instead of popping. -->
    <svg
      class="check"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--sk-text-1)"
      stroke-width="3.4"
      stroke-linecap="round"
      stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
    >
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
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--sk-fill-36);
    transition:
      background 0.14s,
      box-shadow 0.14s;
  }

  .box.on {
    background: var(--sk-accent);
    box-shadow: none;
  }

  .check {
    opacity: 0;
    transform: scale(0.5);
    transition:
      opacity 0.14s,
      transform 0.18s cubic-bezier(0.3, 1.6, 0.5, 1);
  }

  .box.on .check {
    opacity: 1;
    transform: scale(1);
  }

  .label {
    font-size: var(--sk-fs-6);
    color: var(--sk-text-secondary);
  }

  .label.on {
    color: var(--sk-text);
  }
</style>
