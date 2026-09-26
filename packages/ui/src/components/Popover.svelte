<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A custom dropdown container: opens under its trigger, closes on outside click and Esc. The menu
   * is placed against the window, so a scrolling parent (a modal body) never clips it.
   */
  let {
    open = $bindable(false),
    width,
    align = 'left',
    offset = 34,
    maxHeight,
    trigger,
    children,
  }: {
    open?: boolean;
    width?: number | string;
    align?: 'left' | 'right';
    offset?: number;
    /** Longer menus scroll inside this height. */
    maxHeight?: number;
    trigger: Snippet<[{ toggle: () => void; open: boolean }]>;
    children: Snippet<[{ close: () => void }]>;
  } = $props();

  let root: HTMLDivElement | undefined = $state();
  let place = $state<{ top: number; left: number; right: number; width: number } | undefined>();

  const toggle = () => (open = !open);
  const close = () => (open = false);

  function measure(): void {
    const rect = root?.getBoundingClientRect();
    if (!rect) return;
    const next = {
      top: rect.top + offset,
      left: rect.left,
      right: window.innerWidth - rect.right,
      width: rect.width,
    };
    if (
      place?.top !== next.top ||
      place.left !== next.left ||
      place.right !== next.right ||
      place.width !== next.width
    )
      place = next;
  }

  $effect(() => {
    if (!open) return;
    // The trigger moves with scrolling parents and opening animations; the menu follows it.
    let frame = 0;
    const follow = () => {
      measure();
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  });

  const menuWidth = $derived(
    width === '100%' && place
      ? `${place.width}px`
      : width === undefined
        ? undefined
        : typeof width === 'number'
          ? `${width}px`
          : width,
  );

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
  {#if open && place}
    <div
      class="menu"
      class:scroll={maxHeight !== undefined}
      role="menu"
      style="top: {place.top}px; {align}: {align === 'left'
        ? place.left
        : place.right}px; {menuWidth ? `width: ${menuWidth};` : ''} {maxHeight
        ? `max-height: ${maxHeight}px;`
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
    position: fixed;
    z-index: 90;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 5px;
    border-radius: var(--sk-radius-card);
    background: var(--sk-menu);
    box-shadow: var(--sk-menu-shadow);
    animation: skIn 0.14s ease-out;
  }

  .menu.scroll {
    overflow-y: auto;
  }
</style>
