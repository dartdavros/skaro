<script lang="ts">
  /**
   * One tooltip for the whole app: any element with `data-tip` shows it on hover. Black, no
   * border, sized to content up to 260px, never outside the window (11 · Обратная связь).
   */
  let tip: { text: string; x: number; y: number; below: boolean } | undefined = $state();

  function over(e: MouseEvent): void {
    const el = (e.target as Element | null)?.closest?.('[data-tip]');
    const text = el?.getAttribute('data-tip');
    if (!el || !text) {
      tip = undefined;
      return;
    }
    const r = el.getBoundingClientRect();
    const w = Math.min(260, 6.6 * text.length + 20);
    const vw = window.innerWidth;
    const x = Math.max(w / 2 + 8, Math.min(vw - w / 2 - 8, r.left + r.width / 2));
    const below = r.top < 50;
    tip = { text, x, y: below ? r.bottom + 8 : r.top - 8, below };
  }

  function out(e: MouseEvent): void {
    const to = (e.relatedTarget as Element | null)?.closest?.('[data-tip]');
    if (!to) tip = undefined;
  }
</script>

<svelte:document onmouseover={over} onmouseout={out} onpointerdown={() => (tip = undefined)} />

{#if tip}
  <div
    class="tip"
    role="tooltip"
    style="left: {tip.x}px; top: {tip.y}px; transform: translate(-50%, {tip.below ? '0' : '-100%'})"
  >
    {tip.text}
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
    background: #000000;
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.6);
    color: var(--sk-text);
    font-size: 11.5px;
    line-height: 1.4;
    text-wrap: pretty;
    pointer-events: none;
  }
</style>
