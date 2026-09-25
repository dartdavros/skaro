<script lang="ts">
  import { t } from '../i18n.svelte.ts';
  import Icon from './Icon.svelte';

  /**
   * Effort slider (docs/mockups/EffortSlider): the steps come from the model (2–5). Drag, click
   * the track or use the arrow keys; the button on the right resets to the model default.
   */
  let {
    levels,
    value = $bindable(),
    defaultValue,
    tips = {},
  }: {
    levels: { id: string; label: string }[];
    value: string;
    defaultValue?: string;
    tips?: Record<string, string>;
  } = $props();

  let track: HTMLDivElement | undefined = $state();
  let dragging = $state(false);

  const index = $derived(
    Math.max(
      0,
      levels.findIndex((l) => l.id === value),
    ),
  );
  const n = $derived(levels.length);
  const current = $derived(levels[index]);
  const fallback = $derived(defaultValue ?? levels[Math.floor((n - 1) / 2)]?.id ?? '');

  function pos(k: number): string {
    return n > 1 ? `calc(12px + (100% - 24px) * ${(k / (n - 1)).toFixed(4)})` : '50%';
  }

  function pick(k: number): void {
    const clamped = Math.max(0, Math.min(n - 1, k));
    const next = levels[clamped];
    if (next) value = next.id;
  }

  function fromX(x: number): void {
    if (!track) return;
    const r = track.getBoundingClientRect();
    const f = (x - r.left - 12) / Math.max(1, r.width - 24);
    pick(Math.round(f * (n - 1)));
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
      pick(index + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      pick(index - 1);
    }
  }

  const resetLabel = $derived(levels.find((l) => l.id === fallback)?.label ?? fallback);
</script>

<div class="slider">
  <div class="head">
    <span class="hint" data-tip={t('ui.effort.hint')}
      ><Icon name="bolt" size={15} stroke={1.9} /></span
    >
    <div class="name">
      <span data-tip={current ? tips[current.id] : undefined}>{current?.label}</span>
    </div>
    <button
      type="button"
      class="reset"
      data-tip={t('ui.effort.reset', { level: resetLabel })}
      aria-label={t('ui.effort.reset', { level: resetLabel })}
      onclick={() => (value = fallback)}
    >
      <Icon name="reset" size={14} stroke={1.9} />
    </button>
  </div>
  <div
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
    <div
      class="fill"
      style="width: {n > 1
        ? `calc(23px + (100% - 24px) * ${(index / (n - 1)).toFixed(4)})`
        : '100%'}"
    ></div>
    {#each levels as level, k (level.id)}
      <span
        class="dot"
        data-tip={level.label}
        style="left: {pos(k)}; background: {k < index
          ? 'rgba(255,255,255,.55)'
          : k === index
            ? 'transparent'
            : '#4a4a4a'}"
      ></span>
    {/each}
    <span class="knob" style="left: {pos(index)}"></span>
  </div>
</div>

<style>
  .slider {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 14px 14px;
    border-radius: 12px;
    background: #171717;
    user-select: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .hint {
    flex: none;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--sk-text-label);
  }

  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    justify-content: center;
    font-size: 14px;
    font-weight: 700;
    color: var(--sk-link);
    cursor: default;
  }

  .reset {
    flex: none;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-text-muted);
    cursor: pointer;
  }

  .reset:hover {
    background: var(--sk-surface-2);
    color: var(--sk-text-bright);
  }

  .track {
    position: relative;
    height: 24px;
    border-radius: 999px;
    background: var(--sk-surface-2);
    cursor: pointer;
    outline: none;
    touch-action: none;
  }

  .track:focus-visible {
    box-shadow: 0 0 0 1px var(--sk-accent);
  }

  .fill,
  .knob {
    transition:
      left 0.15s,
      width 0.15s;
  }

  .dragging .fill,
  .dragging .knob {
    transition:
      left 0.08s,
      width 0.08s;
  }

  .fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    border-radius: 999px;
    background: var(--sk-accent-hover);
  }

  .dot {
    position: absolute;
    top: 50%;
    width: 4px;
    height: 4px;
    margin: -2px 0 0 -2px;
    border-radius: 50%;
  }

  .knob {
    position: absolute;
    top: 50%;
    width: 22px;
    height: 22px;
    margin: -11px 0 0 -11px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
  }
</style>
