<script lang="ts">
  /**
   * One tooltip for the whole app: any element with `data-tip` shows it on hover. Black, no
   * border, sized to content up to 260px, never outside the window (11 · Обратная связь).
   * `data-tip-side="right"` puts it to the right of the element, centred on it; `data-tip-sub`
   * adds a muted second line, `data-tip-dot` a status dot before it (need, review, working).
   */
  interface Tip {
    text: string;
    sub?: string | undefined;
    dot?: string | undefined;
    x: number;
    y: number;
    side: 'above' | 'below' | 'right';
  }

  let tip: Tip | undefined = $state();
  let height = $state(0);

  /** A tooltip on the right stays inside the window vertically. */
  const top = $derived(
    tip?.side === 'right'
      ? Math.max(height / 2 + 8, Math.min(window.innerHeight - height / 2 - 8, tip.y))
      : (tip?.y ?? 0),
  );

  function over(e: MouseEvent): void {
    // No tips while a button is held: dragging a card, a resizer, a slider.
    if (e.buttons) {
      tip = undefined;
      return;
    }
    const el = (e.target as Element | null)?.closest?.('[data-tip]');
    const text = el?.getAttribute('data-tip');
    if (!el || !text) {
      tip = undefined;
      return;
    }
    const r = el.getBoundingClientRect();
    const sub = el.getAttribute('data-tip-sub') ?? undefined;
    const dot = el.getAttribute('data-tip-dot') ?? undefined;
    if (el.getAttribute('data-tip-side') === 'right') {
      tip = { text, sub, dot, x: r.right + 10, y: r.top + r.height / 2, side: 'right' };
      return;
    }
    const w = Math.min(260, 6.6 * Math.max(text.length, sub?.length ?? 0) + 20);
    const vw = window.innerWidth;
    const x = Math.max(w / 2 + 8, Math.min(vw - w / 2 - 8, r.left + r.width / 2));
    const below = r.top < 50;
    tip = {
      text,
      sub,
      dot,
      x,
      y: below ? r.bottom + 8 : r.top - 8,
      side: below ? 'below' : 'above',
    };
  }

  function out(e: MouseEvent): void {
    const to = (e.relatedTarget as Element | null)?.closest?.('[data-tip]');
    if (!to) tip = undefined;
  }

  const transform = (side: Tip['side']): string =>
    side === 'right' ? 'translateY(-50%)' : `translate(-50%, ${side === 'below' ? '0' : '-100%'})`;
</script>

<svelte:document onmouseover={over} onmouseout={out} onpointerdown={() => (tip = undefined)} />

{#if tip}
  <div
    class="tip"
    class:rich={tip.sub !== undefined}
    role="tooltip"
    bind:offsetHeight={height}
    style="left: {tip.x}px; top: {top}px; transform: {transform(tip.side)}"
  >
    {#if tip.sub !== undefined}
      <span class="line">{tip.text}</span>
      <span class="sub"
        >{#if tip.dot}<span class="dot {tip.dot}"></span>{/if}{tip.sub}</span
      >
    {:else}
      {tip.text}
    {/if}
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: 1000;
    width: max-content;
    max-width: 260px;
    padding: 6px 9px;
    border-radius: 7px;
    background: var(--sk-fill-1);
    box-shadow: 0 10px 26px var(--sk-black-a60);
    color: var(--sk-text);
    font-size: var(--sk-fs-3);
    line-height: 1.4;
    text-wrap: pretty;
    pointer-events: none;
  }

  .tip.rich {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px 10px;
    animation: skFade 0.12s ease-out;
  }

  .sub {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--sk-fs-2);
    color: var(--sk-text-21);
  }

  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .dot.need {
    background: var(--sk-accent);
  }

  .dot.review {
    box-shadow: inset 0 0 0 1.5px var(--sk-accent);
  }

  .dot.working {
    background: var(--sk-fill-41);
  }
</style>
