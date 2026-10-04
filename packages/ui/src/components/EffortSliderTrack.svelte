<script lang="ts">
  import { t } from '../i18n.svelte.ts';
  import { fillWidth, stepAt, stepPosition, tickColor } from './effort-slider.ts';

  /**
   * The slider track: drag, click or arrow keys pick a step, Home the default step `def`;
   * `onpick` gets an unclamped index.
   */
  let {
    levels,
    index,
    def,
    onpick,
  }: {
    levels: { id: string; label: string }[];
    index: number;
    def: number;
    onpick: (k: number) => void;
  } = $props();

  let track: HTMLDivElement | undefined = $state();

  const n = $derived(levels.length);
  const current = $derived(levels[index]);

  function fromX(x: number): void {
    if (!track) return;
    onpick(stepAt(x, track.getBoundingClientRect(), n));
  }

  function down(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    track?.focus();
    fromX(e.clientX);
    const move = (ev: PointerEvent) => fromX(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
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
    } else if (e.key === 'Home') {
      e.preventDefault();
      onpick(def);
    }
  }
</script>

<div
  data-effort-slider
  bind:this={track}
  class="track"
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
      class="tick"
      class:default={k === def}
      data-tip={level.label}
      style="left: {stepPosition(k, n)}; background: {tickColor(k, index, def)}"
    ></span>
  {/each}
  <span data-effort-slider class="knob" style="left: {stepPosition(index, n)}"></span>
</div>
