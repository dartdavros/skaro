<script lang="ts">
  import { t } from '../i18n.svelte.ts';

  /** Window buttons for the frameless window on Windows and Linux (macOS keeps its own). */
  let {
    maximized = false,
    onminimize,
    onmaximize,
    onclose,
  }: {
    maximized?: boolean;
    onminimize: () => void;
    onmaximize: () => void;
    onclose: () => void;
  } = $props();
</script>

<div class="controls">
  <button
    type="button"
    data-tip={t('window.minimize')}
    aria-label={t('window.minimize')}
    onclick={onminimize}
  >
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"><path d="M5 12h14" /></svg
    >
  </button>
  <button
    type="button"
    data-tip={maximized ? t('window.restore') : t('window.maximize')}
    aria-label={maximized ? t('window.restore') : t('window.maximize')}
    onclick={onmaximize}
  >
    {#if maximized}
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        ><rect x="8" y="8" width="11" height="11" rx="1" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></svg
      >
    {:else}
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"><rect x="5" y="5" width="14" height="14" rx="1" /></svg
      >
    {/if}
  </button>
  <button
    type="button"
    class="close"
    data-tip={t('window.close')}
    aria-label={t('window.close')}
    onclick={onclose}
  >
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg
    >
  </button>
</div>

<style>
  .controls {
    display: flex;
    align-items: center;
    gap: 2px;
    -webkit-app-region: no-drag;
  }

  button {
    width: 30px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--sk-icon);
    cursor: pointer;
  }

  button:hover {
    background: #111111;
    color: var(--sk-text-bright);
  }

  .close:hover {
    background: var(--sk-accent);
    color: #ffffff;
  }
</style>
