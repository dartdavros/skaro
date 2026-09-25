<script lang="ts">
  import type { Snippet } from 'svelte';

  /** A custom dropdown container: opens under its trigger, closes on outside click and Esc. */
  let {
    open = $bindable(false),
    width,
    align = 'left',
    offset = 34,
    trigger,
    children,
  }: {
    open?: boolean;
    width?: number | string;
    align?: 'left' | 'right';
    offset?: number;
    trigger: Snippet<[{ toggle: () => void; open: boolean }]>;
    children: Snippet<[{ close: () => void }]>;
  } = $props();

  let root: HTMLDivElement | undefined = $state();

  const toggle = () => (open = !open);
  const close = () => (open = false);

  $effect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', esc);
    };
  });
</script>

<div class="anchor" bind:this={root}>
  {@render trigger({ toggle, open })}
  {#if open}
    <div
      class="menu"
      role="menu"
      style="top: {offset}px; {align}: 0; {width
        ? `width: ${typeof width === 'number' ? `${width}px` : width};`
        : ''}"
    >
      {@render children({ close })}
    </div>
  {/if}
</div>

<style>
  .anchor {
    position: relative;
  }

  .menu {
    position: absolute;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 5px;
    border-radius: var(--sk-radius-card);
    background: var(--sk-menu);
    box-shadow: var(--sk-menu-shadow);
    animation: skIn 0.14s ease-out;
  }
</style>
