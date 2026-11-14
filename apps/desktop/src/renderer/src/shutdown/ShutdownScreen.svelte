<script lang="ts">
  import { t } from '@skaro/ui';
  import type { ShutdownState } from '../../../shared/shutdown';
  import TitleBar from '../TitleBar.svelte';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import ShutdownDetails from './ShutdownDetails.svelte';
  import ShutdownFooter from './ShutdownFooter.svelte';
  import './i18n';
  let { state, time, slow }: { state: ShutdownState; time: string; slow: boolean } = $props();
</script>

<div class="shutdown-app">
  <TitleBar closing />
  <main class="shutdown-content">
    <section class="shutdown-state" aria-label={t('shutdown.title')}>
      <div class="spinner" aria-hidden="true"><LoadingIndicator /></div>
      <h1>{t('shutdown.title')}</h1>
      <div class="stage" role="status" aria-live="polite">
        {t(`shutdown.current.${state.stage}`)}
      </div>
      <div class="elapsed" aria-label={t('shutdown.elapsed')}>{time}</div>
      <div class="wait-note" class:visible={slow}>{t('shutdown.slow')}</div>
      <ShutdownDetails {state} />
    </section>
    <ShutdownFooter />
  </main>
</div>

<style>
  .shutdown-app {
    --shutdown-dim: #656565;
    line-height: 1.5;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--sk-bg);
    overflow: hidden;
  }
  .shutdown-content {
    position: relative;
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    padding: 50px 24px 118px;
    overflow-y: auto;
  }
  .shutdown-state {
    width: min(100%, 356px);
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .spinner {
    display: flex;
    margin-bottom: 20px;
  }
  h1 {
    margin: 0 0 8px;
    color: var(--sk-text-bright);
    font-size: 20px;
    line-height: 1.4;
    font-weight: 600;
  }
  .stage {
    min-height: 24px;
    text-align: center;
    color: var(--sk-text-secondary);
    font-size: var(--sk-fs-6);
  }
  .elapsed {
    min-height: 21px;
    margin-top: 8px;
    color: var(--sk-text-muted);
    font-size: var(--sk-fs-4);
    font-variant-numeric: tabular-nums;
  }
  .wait-note {
    min-height: 38px;
    margin-top: 14px;
    color: var(--sk-text-muted);
    font-size: var(--sk-fs-4);
    text-align: center;
    visibility: hidden;
  }
  .wait-note.visible {
    visibility: visible;
  }
</style>
