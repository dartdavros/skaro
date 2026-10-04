<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A row of a settings card: the name and an optional note on the left, the control on the
   * right; the card draws a line between rows. `tall` is the row of a switch or a
   * stepper (13px instead of 12px above and below).
   */
  let {
    title,
    note,
    tall = false,
    name,
    children,
  }: {
    title?: string;
    note?: string;
    tall?: boolean;
    /** The left side when it is more than a title and a note. */
    name?: Snippet;
    children?: Snippet;
  } = $props();
</script>

<div class="set-row" class:tall>
  <div class="set-texts">
    {#if name}{@render name()}{:else}
      <span class="set-row-title">{title}</span>
      {#if note}<span class="set-row-note">{note}</span>{/if}
    {/if}
  </div>
  {@render children?.()}
</div>

<style>
  .set-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
  }

  .set-row.tall {
    padding: 13px 16px;
  }

  .set-texts {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .set-row-title {
    font-size: var(--sk-fs-6);
    color: var(--sk-text-7);
  }

  .set-row-note {
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
    text-wrap: pretty;
  }

  .tall .set-row-note {
    line-height: 1.45;
  }
</style>
