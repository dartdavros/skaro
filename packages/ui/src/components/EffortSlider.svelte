<script lang="ts">
  import { t } from '../i18n.svelte.ts';
  import EffortSliderTrack from './EffortSliderTrack.svelte';
  import { recommendedShift, stepPosition } from './effort-slider.ts';
  import './effort-slider.css';

  /**
   * Effort slider (docs/mockups/EffortSlider): the steps come from the model (2–5). Drag, click
   * the track or use the arrow keys; Home returns to the model default, marked "Рекомендуется".
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
  const def = $derived(
    Math.max(
      0,
      levels.findIndex((l) => l.id === fallback),
    ),
  );

  function pick(k: number): void {
    const clamped = Math.max(0, Math.min(n - 1, k));
    const next = levels[clamped];
    if (next) value = next.id;
  }
</script>

<div data-effort-slider class="slider">
  <div data-effort-slider class="head">
    <span data-effort-slider class="caption" data-tip={t('ui.effort.hint')}>{t('ui.effort')}</span>
    <span data-effort-slider class="name" data-tip={current ? tips[current.id] : undefined}
      >{current?.label}</span
    >
  </div>
  <div data-effort-slider class="ends">
    <span>{t('ui.effort.faster')}</span><span>{t('ui.effort.smarter')}</span>
  </div>
  <EffortSliderTrack {levels} {index} {def} onpick={pick} />
  <div data-effort-slider class="below">
    <span
      data-effort-slider
      class="recommended"
      class:on={index === def}
      style="left: {stepPosition(def, n)}; transform: translateX({recommendedShift(def, n)})"
      >{t('ui.effort.recommended')}</span
    >
  </div>
</div>
