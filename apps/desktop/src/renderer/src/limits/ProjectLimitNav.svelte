<script lang="ts">
  import type { AgentLimits } from '@skaro/timeline';
  import { i18n, t } from '@skaro/ui';
  import { limitGaugeColor, remainingLimit } from './low-remaining';
  import './project-limit-nav.css';

  let {
    rail,
    snapshot,
    warning,
    onclick,
  }: {
    rail: boolean;
    snapshot?: AgentLimits;
    warning?: string;
    onclick: () => void;
  } = $props();
  const id = $props.id();
  let anchor = $state<HTMLButtonElement>();
  let tooltip = $state<HTMLDivElement>();
  let hovered = $state(false);
  let focused = $state(false);
  let dismissed = $state(false);
  let position = $state({ left: 0, top: 0 });
  const visible = $derived((hovered || focused) && !dismissed);
  const remaining = $derived(remainingLimit(snapshot));
  const color = $derived(limitGaugeColor(remaining));
  const dash = $derived(`${remaining ?? 0} 100`);
  const windows = $derived(
    (['five_hour', 'seven_day'] as const).flatMap((kind) => {
      const window = snapshot?.windows.find((value) => value.kind === kind);
      return window ? [window] : [];
    }),
  );
  const percent = (value: number | null) =>
    typeof value === 'number' && Number.isFinite(value)
      ? new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 1 }).format(value) + '%'
      : '—';

  $effect(() => {
    if (!visible) return;
    let frame = 0;
    const follow = () => {
      if (anchor && tooltip) {
        const rect = anchor.getBoundingClientRect();
        const next = {
          left: Math.max(8, Math.min(rect.right + 10, window.innerWidth - tooltip.offsetWidth - 8)),
          top: Math.max(
            8,
            Math.min(
              rect.bottom - tooltip.offsetHeight,
              window.innerHeight - tooltip.offsetHeight - 8,
            ),
          ),
        };
        if (next.left !== position.left || next.top !== position.top) position = next;
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  });
</script>

<button
  bind:this={anchor}
  type="button"
  class={rail ? 'rail-item' : 'item footer-item'}
  aria-label={t('limits.title')}
  aria-describedby={visible ? id : undefined}
  onpointerenter={() => {
    hovered = true;
    dismissed = false;
  }}
  onpointerleave={() => (hovered = false)}
  onfocus={() => {
    focused = true;
    dismissed = false;
  }}
  onblur={() => (focused = false)}
  onkeydown={(event) => {
    if (event.key === 'Escape') dismissed = true;
  }}
  onclick={() => {
    dismissed = true;
    onclick();
  }}
>
  <span class="limit-gauge" aria-hidden="true">
    <svg width="21" height="21" viewBox="0 0 16 16" style="transform: rotate(-90deg)">
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke={remaining === 0 ? color : 'var(--sk-fill-35)'}
        stroke-opacity={remaining === 0 ? 0.45 : 1}
        stroke-width="1.8"
      />
      {#if remaining !== undefined && remaining > 0}
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke={color}
          stroke-width="1.8"
          stroke-linecap="butt"
          pathLength="100"
          stroke-dasharray={dash}
        />
      {/if}
    </svg>
  </span>
  {#if !rail}
    <span class="label">{t('limits.title')}</span>
    {#if warning}<span class="count">{warning}</span>{/if}
  {/if}
</button>

{#if visible}
  <div
    bind:this={tooltip}
    {id}
    class="limit-tooltip"
    role="tooltip"
    style:left="{position.left}px"
    style:top="{position.top}px"
    style:visibility={position.left === 0 ? 'hidden' : undefined}
  >
    <span class="limit-tooltip-title">{t('limits.title')}</span>
    {#each windows as window (window.kind)}
      <div class="limit-tooltip-row">
        <span>{t(`limits.${window.kind}`)}</span>
        <span class="limit-tooltip-percent">{percent(window.remainingPercent)}</span>
      </div>
    {:else}
      <span class="limit-tooltip-empty">{t('limits.unavailable')}</span>
    {/each}
  </div>
{/if}
