<script lang="ts">
  import { t } from '../i18n.svelte.ts';
  import EffortSliderTrack from './EffortSliderTrack.svelte';
  import Icon from './Icon.svelte';
  import './effort-slider.css';

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

  const index = $derived(
    Math.max(
      0,
      levels.findIndex((l) => l.id === value),
    ),
  );
  const n = $derived(levels.length);
  const current = $derived(levels[index]);
  const fallback = $derived(defaultValue ?? levels[Math.floor((n - 1) / 2)]?.id ?? '');

  function pick(k: number): void {
    const clamped = Math.max(0, Math.min(n - 1, k));
    const next = levels[clamped];
    if (next) value = next.id;
  }

  const resetLabel = $derived(levels.find((l) => l.id === fallback)?.label ?? fallback);
</script>

<div data-effort-slider class="slider">
  <div data-effort-slider class="head">
    <span data-effort-slider class="hint" data-tip={t('ui.effort.hint')}
      ><Icon name="bolt" size={15} stroke={1.9} /></span
    >
    <div data-effort-slider class="name">
      <span data-effort-slider data-tip={current ? tips[current.id] : undefined}
        >{current?.label}</span
      >
    </div>
    <button
      data-effort-slider
      type="button"
      class="reset"
      data-tip={t('ui.effort.reset', { level: resetLabel })}
      aria-label={t('ui.effort.reset', { level: resetLabel })}
      onclick={() => (value = fallback)}
    >
      <Icon name="reset" size={14} stroke={1.9} />
    </button>
  </div>
  <EffortSliderTrack {levels} {index} onpick={pick} />
</div>
