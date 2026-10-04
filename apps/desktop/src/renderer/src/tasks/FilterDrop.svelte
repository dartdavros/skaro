<script lang="ts" generics="T extends string">
  import { Checkbox, Popover } from '@skaro/ui';
  import type { Snippet } from 'svelte';

  /**
   * A filter of the task board (Tasks mockup): the button shows the filter name, the only chosen
   * value, or "Статус · 2"; the menu lists values with a marker and a count.
   */
  let {
    label,
    options,
    selected = $bindable([]),
    width,
    marker,
  }: {
    label: string;
    /** `short` is what the button shows when only this value is chosen. */
    options: { value: T; label: string; count: number; short?: string }[];
    selected?: T[];
    width: number;
    marker: Snippet<[T]>;
  } = $props();

  let open = $state(false);

  const text = $derived(
    selected.length === 0
      ? label
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.short ??
          options.find((o) => o.value === selected[0])?.label ??
          label)
        : `${label} · ${selected.length}`,
  );

  function toggle(value: T): void {
    selected = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
  }
</script>

<Popover bind:open {width} offset={36}>
  {#snippet trigger({ toggle: toggleMenu })}
    <button
      type="button"
      class="drop"
      class:open
      class:on={selected.length > 0}
      onclick={toggleMenu}
    >
      {text}
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg
      >
    </button>
  {/snippet}
  {#each options as option (option.value)}
    <div
      class="row"
      role="menuitemcheckbox"
      aria-checked={selected.includes(option.value)}
      tabindex="-1"
      onclick={() => toggle(option.value)}
      onkeydown={(e) => e.key === 'Enter' && toggle(option.value)}
    >
      <span class="box"><Checkbox checked={selected.includes(option.value)} /></span>
      {@render marker(option.value)}
      <span class="label">{option.label}</span>
      <span class="count">{option.count}</span>
    </div>
  {/each}
</Popover>

<style>
  .drop {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 7px;
    min-width: 120px;
    height: 31px;
    padding: 0 11px;
    border: none;
    border-radius: 8px;
    background: var(--sk-deep);
    color: var(--sk-text-17);
    font-size: var(--sk-fs-5);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }

  .drop.on {
    background: var(--sk-teal-2);
    color: var(--sk-teal-1);
  }

  .drop.open {
    background: var(--sk-fill-20);
    color: var(--sk-text-2);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 8px;
    border-radius: 7px;
    cursor: pointer;
  }

  .row:hover {
    background: var(--sk-fill-26);
  }

  /* The row toggles; the checkbox only shows the state. */
  .box {
    display: inline-flex;
    pointer-events: none;
  }

  .label {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-5);
    color: var(--sk-text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex: none;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-2);
    color: var(--sk-text-21);
  }
</style>
