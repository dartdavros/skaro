<script lang="ts">
  import { onMount } from 'svelte';
  import { Icon, t } from '@skaro/ui';
  import { Maximize2 } from '@lucide/svelte';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import type { C4Model, C4View } from '@skaro/core/c4-view';
  import { layoutC4 } from './layout';
  import C4PreviewSvg from './C4PreviewSvg.svelte';
  import { viewKindIcons } from './view-kinds';
  import './styles.css';
  import './i18n';
  let { model, view, onopen }: { model: C4Model; view: C4View; onopen: () => void } = $props();
  let root: HTMLElement;
  let visible = $state(false);
  const placed = $derived(visible ? layoutC4(model, view) : undefined);
  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          visible = true;
          observer.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(root);
    return () => observer.disconnect();
  });
</script>

<section class="c4-preview" data-c4-preview={view.id} bind:this={root}>
  <button type="button" class="open" onclick={onopen} aria-label={`${t('c4.open')}: ${view.title}`}>
    <div class="preview-header">
      <Icon name={viewKindIcons[view.kind]} size={16} />
      <span class="title">{view.title}</span><Maximize2 size={15} strokeWidth={1.8} />
    </div>
    <div class="preview-body">
      {#if placed}
        {#await placed}
          <LoadingIndicator size={20} />
        {:then graph}
          <C4PreviewSvg {graph} title={view.title} />
        {:catch error}
          <div class="c4-error">{String(error)}</div>
        {/await}
      {:else}
        <LoadingIndicator size={20} />
      {/if}
    </div>
    <div class="preview-footer">
      <span>C4 · {t('c4.revision', { n: model.revision })}</span>
      <span class="kind">{t(`c4.${view.kind}`)} · {t(`c4.${view.state}`)}</span>
    </div>
  </button>
</section>

<style>
  .c4-preview {
    width: 100%;
    min-width: 0;
    min-height: calc(var(--c4-preview-height, 340px) + 84px);
    border: 1px solid var(--sk-line-strong);
    border-radius: 12px;
    overflow: hidden;
  }
  .open {
    display: block;
    width: 100%;
    border: 0;
    padding: 0;
    text-align: left;
    background: var(--sk-surface);
    color: var(--sk-text);
    cursor: pointer;
  }
  .open:focus-visible {
    outline: 2px solid var(--sk-link);
    outline-offset: -3px;
  }
  .preview-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 15px 18px;
  }
  .title {
    flex: 1;
    font-size: 14px;
    font-weight: 700;
    color: var(--sk-text-bright);
  }
  .preview-body {
    display: grid;
    place-items: center;
    width: 100%;
    height: var(--c4-preview-height, 340px);
    min-height: var(--c4-preview-height, 340px);
    overflow: hidden;
    background: var(--sk-bg);
  }
  .kind {
    font-size: 11px;
    color: var(--sk-text-muted);
    text-align: right;
  }
  .preview-footer {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 11px 18px;
    border-top: 1px solid var(--sk-line);
    font-size: 11px;
    color: var(--sk-text-muted);
  }
  .open:hover .preview-footer {
    background: var(--sk-surface-2);
  }
</style>
