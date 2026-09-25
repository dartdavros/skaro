<script lang="ts">
  import { t } from '@skaro/ui';

  /** An image over the screen; click or Esc closes it. */
  let { src = $bindable() }: { src: string | undefined } = $props();
</script>

<svelte:window onkeydown={(e) => src && e.key === 'Escape' && (src = undefined)} />

{#if src}
  <button
    type="button"
    class="viewer"
    aria-label={t('ui.closeEsc')}
    onclick={() => (src = undefined)}
  >
    <img {src} alt="" />
  </button>
{/if}

<style>
  .viewer {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    border: none;
    background: rgba(0, 0, 0, 0.78);
    backdrop-filter: blur(6px);
    cursor: zoom-out;
    animation: skIn 0.14s ease-out;
  }

  img {
    max-width: 100%;
    max-height: 100%;
    border-radius: 8px;
    box-shadow: 0 30px 70px rgba(0, 0, 0, 0.6);
    object-fit: contain;
  }
</style>
