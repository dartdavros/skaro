<script lang="ts">
  import { onDestroy } from 'svelte';
  let {
    width,
    min,
    max,
    side,
    controls,
    label,
    onresize,
    oncommit,
  }: {
    width: number;
    min: number;
    max: number;
    side: 'left' | 'right';
    controls: string;
    label: string;
    onresize: (width: number) => void;
    oncommit: () => void;
  } = $props();
  let stopDrag: (() => void) | undefined;
  /** While dragging the line and the pill stay lit, even with the pointer off the grip. */
  let dragging = $state(false);
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  onDestroy(() => stopDrag?.());

  function resize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    stopDrag?.();
    const startX = event.clientX;
    const startWidth = width;
    dragging = true;
    document.body.style.cursor = 'col-resize';
    const direction = side === 'left' ? 1 : -1;
    const move = (next: PointerEvent) => {
      if (next.pointerId === event.pointerId)
        onresize(clamp(startWidth + direction * (next.clientX - startX)));
    };
    const end = (next: PointerEvent) => {
      if (next.pointerId === event.pointerId) finish();
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', finish);
      stopDrag = undefined;
      dragging = false;
      document.body.style.cursor = '';
      oncommit();
    };
    stopDrag = finish;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', finish);
  }

  function resizeWithKey(event: KeyboardEvent): void {
    const step = (event.shiftKey ? 10 : 1) * (side === 'left' ? 1 : -1);
    const values: Record<string, number> = {
      ArrowLeft: width - step,
      ArrowRight: width + step,
      Home: min,
      End: max,
    };
    const next = values[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onresize(clamp(next));
    oncommit();
  }
</script>

<div class="resizer sk-panel-resizer" class:dragging data-panel-side={side}>
  <!-- A focusable separator implements the ARIA window splitter widget. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="grip"
    role="separator"
    tabindex="0"
    aria-label={label}
    aria-orientation="vertical"
    aria-controls={controls}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={width}
    data-tip={label}
    onpointerdown={resize}
    onkeydown={resizeWithKey}
  ></div>
  <span class="pill"></span>
</div>

<style>
  .resizer {
    flex: none;
    position: relative;
    width: 1px;
    background: var(--sk-line);
    z-index: 5;
    transition: background 0.15s;
  }
  .grip {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -4px;
    width: 9px;
    cursor: col-resize;
    touch-action: none;
  }
  .pill {
    position: absolute;
    top: 50%;
    left: -2px;
    width: 5px;
    height: 32px;
    margin-top: -16px;
    border-radius: 3px;
    background: var(--sk-fill-36);
    box-shadow: 0 0 0 2px var(--sk-bg);
    opacity: 0;
    transition:
      opacity 0.15s,
      background 0.15s;
    pointer-events: none;
  }
  .resizer:has(.grip:hover),
  .resizer.dragging {
    background: var(--sk-fill-28);
  }
  .resizer:has(.grip:hover) .pill,
  .resizer.dragging .pill {
    opacity: 1;
  }
  .resizer.dragging .pill {
    background: var(--sk-fill-39);
  }
</style>
