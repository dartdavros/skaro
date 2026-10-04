<script lang="ts">
  import type { Snippet } from 'svelte';
  import Checkbox from './Checkbox.svelte';
  import Popover from './Popover.svelte';

  /** Multi-select filter: checkbox, a status dot or agent logo, label. */
  let {
    label,
    options,
    selected = $bindable([]),
    width = 214,
    marker,
  }: {
    label: string;
    options: { value: string; label: string }[];
    selected?: string[];
    width?: number;
    marker?: Snippet<[string]>;
  } = $props();

  let open = $state(false);

  function toggle(value: string): void {
    selected = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
  }
</script>

<Popover bind:open {width}>
  {#snippet trigger({ toggle: toggleMenu, open })}
    <button
      type="button"
      class="trigger"
      class:active={open || selected.length > 0}
      onclick={toggleMenu}
    >
      {label}
      {#if selected.length}<span class="count">{selected.length}</span>{/if}
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--sk-text-22)"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg
      >
    </button>
  {/snippet}
  {#each options as option (option.value)}
    <div
      class="option"
      role="menuitemcheckbox"
      aria-checked={selected.includes(option.value)}
      tabindex="-1"
      onclick={() => toggle(option.value)}
      onkeydown={(e) => e.key === 'Enter' && toggle(option.value)}
    >
      <Checkbox checked={selected.includes(option.value)} onchange={() => toggle(option.value)} />
      {#if marker}{@render marker(option.value)}{/if}
      <span class="text">{option.label}</span>
    </div>
  {/each}
</Popover>

<style>
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 10px 0 11px;
    border: none;
    border-radius: var(--sk-radius);
    background: var(--sk-fill-16);
    color: var(--sk-text-7);
    font-size: var(--sk-fs-5);
    font-weight: 600;
    cursor: pointer;
  }

  .trigger.active {
    background: var(--sk-fill-22);
  }

  .trigger:hover {
    background: var(--sk-fill-22);
    color: var(--sk-text-bright);
  }

  .count {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-2);
    color: var(--sk-text-19);
  }

  .option {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 9px;
    border-radius: 7px;
    cursor: pointer;
  }

  .option:hover {
    background: var(--sk-menu-hover);
  }

  .text {
    flex: 1;
    font-size: var(--sk-fs-5);
    color: var(--sk-text);
  }
</style>
