<script lang="ts">
  import { IconButton, Select, t } from '@skaro/ui';
  import { ArrowLeft, ArrowRight, Pause, Play, X, Maximize2 } from '@lucide/svelte';
  import type { ProjectGraph } from './data.svelte';
  import GraphSearch from './GraphSearch.svelte';
  import GraphExportMenu from './GraphExportMenu.svelte';
  import type { GraphExportSource } from './export-graph';
  let {
    model,
    live,
    exportSource,
    motion,
    onpause,
    onfullscreen,
  }: {
    model: ProjectGraph;
    live?: GraphExportSource | undefined;
    exportSource?: HTMLElement | undefined;
    motion: boolean;
    onpause: () => void;
    onfullscreen: () => void;
  } = $props();
  const options = $derived([
    { value: 'overview', label: t('graph.entireProject') },
    ...model.scenarios.map((scenario) => ({
      value: scenario.viewId,
      label: scenario.title,
      description: t(`c4.${scenario.state}`),
    })),
  ]);
</script>

<header class="c4-viewer-header">
  <IconButton tip={t('graph.back')} disabled={model.historyIndex < 1} onclick={() => model.back(-1)}
    ><ArrowLeft size={15} /></IconButton
  >
  <IconButton
    tip={t('graph.forward')}
    disabled={model.historyIndex >= model.history.length - 1}
    onclick={() => model.back(1)}><ArrowRight size={15} /></IconButton
  >
  <div class="c4-viewer-heading">
    <strong>{t('graph.title')}</strong><span
      >{model.model?.title ?? t('graph.codeDocs')}{#if model.snapshot?.c4Revision}
        · C4 · {t('c4.revision', { n: model.snapshot.c4Revision })}{/if}</span
    >
  </div>
  <IconButton tip={t(motion ? 'graph.pause' : 'graph.resume')} active={!motion} onclick={onpause}>
    {#if motion}<Pause size={16} />{:else}<Play size={16} />{/if}
  </IconButton>
  <GraphExportMenu {model} {live} surface={exportSource} />
  <IconButton tip={t('c4.fullscreen')} onclick={onfullscreen}><Maximize2 size={15} /></IconButton>
  {#if model.selected}<IconButton
      tip={t('graph.clear')}
      onclick={() => {
        void model.select('');
      }}><X size={15} /></IconButton
    >{/if}
</header>
<nav class="c4-viewer-nav">
  <div class="c4-viewer-select">
    <Select
      {options}
      label={t('c4.view')}
      width="100%"
      menuWidth={480}
      bind:value={
        () => model.playback.scenario?.viewId ?? 'overview',
        (id) => {
          void model.scenario(id);
        }
      }
    />
  </div>
  <GraphSearch
    search={(text) => model.search(text)}
    onselect={(id) => {
      void model.focusNode(id);
    }}
  />
</nav>
