<script lang="ts">
  import type { Snippet } from 'svelte';

  /** Dialog frame of the task board: dimmed backdrop, closes on backdrop click and Esc. */
  let {
    width,
    background = 'var(--sk-fill-15)',
    radius = 13,
    dim = 0.62,
    onclose,
    children,
  }: {
    width: number;
    background?: string;
    radius?: number;
    dim?: number;
    onclose: () => void;
    children: Snippet;
  } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="backdrop" role="presentation" style="background: rgba(0,0,0,{dim})" onclick={onclose}>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    style="width: {width}px; background: {background}; border-radius: {radius}px"
    onclick={(e) => e.stopPropagation()}
    onkeydown={() => undefined}
  >
    {@render children()}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .dialog {
    max-width: 100%;
    overflow: hidden;
    box-shadow: 0 30px 70px var(--sk-black-a65);
    outline: none;
  }
</style>
