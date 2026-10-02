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
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  onDestroy(() => stopDrag?.());

  function resize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    stopDrag?.();
    const startX = event.clientX;
    const startWidth = width;
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

<div class="resizer sk-panel-resizer" data-panel-side={side}>
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
</div>

<style>
  .resizer {
    flex: none;
    position: relative;
    width: 1px;
    background: var(--sk-fill-11);
    z-index: 5;
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
  .grip:hover {
    background: linear-gradient(
      90deg,
      transparent 3px,
      var(--sk-accent) 3px,
      var(--sk-accent) 6px,
      transparent 6px
    );
  }
</style>
