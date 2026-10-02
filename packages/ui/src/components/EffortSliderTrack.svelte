<script lang="ts">
  import { t } from '../i18n.svelte.ts';
  import { dotColor, fillWidth, stepAt, stepPosition } from './effort-slider.ts';

  /** The slider track: drag, click or arrow keys pick a step; `onpick` gets an unclamped index. */
  let {
    levels,
    index,
    onpick,
  }: {
    levels: { id: string; label: string }[];
    index: number;
    onpick: (k: number) => void;
  } = $props();

  let track: HTMLDivElement | undefined = $state();
  let dragging = $state(false);

  const n = $derived(levels.length);
  const current = $derived(levels[index]);

  function fromX(x: number): void {
    if (!track) return;
    onpick(stepAt(x, track.getBoundingClientRect(), n));
  }

  function down(e: PointerEvent): void {
    e.preventDefault();
    track?.focus();
    fromX(e.clientX);
    dragging = true;
    const move = (ev: PointerEvent) => fromX(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dragging = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function key(e: KeyboardEvent): void {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onpick(index + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onpick(index - 1);
    }
  }
</script>

<div
  data-effort-slider
  bind:this={track}
  class="track"
  class:dragging
  role="slider"
  tabindex="0"
  aria-label={t('ui.effort')}
  aria-valuemin={0}
  aria-valuemax={n - 1}
  aria-valuenow={index}
  aria-valuetext={current?.label}
  onpointerdown={down}
  onkeydown={key}
>
  <div data-effort-slider class="fill" style="width: {fillWidth(index, n)}"></div>
  {#each levels as level, k (level.id)}
    <span
      data-effort-slider
      class="dot"
      data-tip={level.label}
      style="left: {stepPosition(k, n)}; background: {dotColor(k, index)}"
    ></span>
  {/each}
  <span data-effort-slider class="knob" style="left: {stepPosition(index, n)}"></span>
</div>
