<script lang="ts">
  import { ArrowLeft, Maximize2, Minimize2, X } from '@lucide/svelte';
  import { Icon, IconButton, Select, t } from '@skaro/ui';
  import C4Search from './C4Search.svelte';
  import type { C4ViewerState } from './viewer-state.svelte';
  import ExportButton from '../diagram-export/ExportButton.svelte';
  let {
    state,
    ongraph,
    exporting,
    onexport,
  }: {
    state: C4ViewerState;
    ongraph?: ((id: string, viewId: string) => void) | undefined;
    exporting: boolean;
    onexport: () => void;
  } = $props();
  const options = $derived(
    state.model.views.map((view) => ({
      value: view.id,
      label: view.title,
      description: `${t(`c4.${view.kind}`)} · ${t(`c4.${view.state}`)}`,
    })),
  );
</script>

<header class="c4-viewer-header">
  <IconButton tip={t('c4.back')} onclick={state.back}
    ><ArrowLeft size={16} strokeWidth={1.8} /></IconButton
  >
  <div class="c4-viewer-heading">
    <strong>{state.model.title}</strong><span
      >C4 · {t('c4.revision', { n: state.model.revision })}</span
    >
  </div>
  <ExportButton busy={exporting} onclick={onexport} />
  <IconButton
    tip={t(state.fullscreen ? 'c4.exitFullscreen' : 'c4.fullscreen')}
    onclick={() => void state.toggleFullscreen()}
  >
    {#if state.fullscreen}<Minimize2 size={15} strokeWidth={1.9} />{:else}<Maximize2
        size={15}
        strokeWidth={1.9}
      />{/if}
  </IconButton>
  {#if ongraph}<IconButton
      tip={t('graph.title')}
      onclick={() => ongraph?.(state.selected, state.view.id)}
      ><Icon name="network" size={16} /></IconButton
    >{/if}
  <IconButton tip={t('c4.close')} onclick={() => void state.close()}
    ><X size={14} strokeWidth={2.2} /></IconButton
  >
</header>
<nav class="c4-viewer-nav">
  <div class="c4-viewer-select">
    <Select
      {options}
      width="100%"
      menuWidth="100%"
      label={t('c4.view')}
      bind:value={() => state.view.id, (id) => state.go(id)}
    />
  </div>
  <C4Search {state} />
</nav>
