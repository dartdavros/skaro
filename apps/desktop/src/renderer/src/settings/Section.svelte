<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A section of "Настройки" (Settings mockup): the title, an optional note under it and a card
   * of rows; `bare` leaves the content without the card (the instructions field).
   */
  let {
    title,
    note,
    bare = false,
    children,
  }: { title: string; note?: string; bare?: boolean; children: Snippet } = $props();
</script>

<section class="set-section">
  <div class="set-head">
    <span class="set-title">{title}</span>
    {#if note}<span class="set-note">{note}</span>{/if}
  </div>
  {#if bare}{@render children()}{:else}<div class="set-card">{@render children()}</div>{/if}
</section>

<style>
  .set-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .set-head {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .set-title {
    font-size: var(--sk-fs-6);
    font-weight: 700;
    color: var(--sk-text-5);
  }

  .set-note {
    font-size: var(--sk-fs-3);
    line-height: 1.45;
    color: var(--sk-text-21);
    text-wrap: pretty;
  }

  /* Also the card of each agent in "Агенты"; rows inside are divided by a line. */
  :global(.set-card) {
    border-radius: 10px;
    background: var(--sk-surface);
  }

  :global(.set-card > * + *) {
    border-top: 1px solid var(--sk-line-strong);
  }
</style>
