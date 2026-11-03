<script lang="ts">
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import { Banner, TooltipHost } from '@skaro/ui';
  import C4Canvas from './C4Canvas.svelte';
  import C4Details from './C4Details.svelte';
  import C4ViewerToolbar from './C4ViewerToolbar.svelte';
  import type { C4ViewerState } from './viewer-state.svelte';
  import { c4Png } from './export-png';
  import { exportName } from '../diagram-export/image';
  import { exportError } from '../diagram-export/i18n';
  let exporting = $state(false);
  async function exportPng(): Promise<void> {
    if (!element || exporting) return;
    const model = viewer.model,
      view = viewer.view,
      source = element;
    exporting = true;
    try {
      const bytes = await c4Png(model, view, source);
      await window.skaro.invoke('diagram.save', {
        name: `${exportName(model.title, view.id, view.state, `r${model.revision}`)}.png`,
        format: 'png',
        bytes,
      });
    } catch (error) {
      viewer.error = exportError(error);
    } finally {
      exporting = false;
    }
  }
  let {
    viewer,
    element = $bindable(),
    ongraph,
  }: {
    viewer: C4ViewerState;
    element?: HTMLDivElement;
    ongraph?: ((id: string, viewId: string) => void) | undefined;
  } = $props();
</script>

<div class="c4-viewer" bind:this={element}>
  <C4ViewerToolbar state={viewer} {ongraph} {exporting} onexport={() => void exportPng()} />
  {#if viewer.error}<Banner
      kind="error"
      text={viewer.error}
      onclose={() => (viewer.error = '')}
    />{/if}
  <div class="content">
    {#key viewer.view.id}<SvelteFlowProvider
        ><C4Canvas
          model={viewer.model}
          view={viewer.view}
          selected={viewer.selected}
          focusRequest={viewer.focusRequest}
          onselect={(id) => (viewer.selected = id)}
          ondrill={viewer.drill}
        /></SvelteFlowProvider
      >{/key}
    {#if viewer.selected}<C4Details
        model={viewer.displayed}
        planned={viewer.view.state === 'planned' &&
          [...viewer.model.elements, ...viewer.model.relationships].some(
            (item) => item.id === viewer.selected && !!item.planned,
          )}
        selected={viewer.selected}
        canDrill={viewer.canDrill(viewer.selected)}
        onselect={(id) => (viewer.selected = id)}
        ondrill={viewer.drill}
      />{/if}
  </div>
  {#if viewer.fullscreen}<TooltipHost />{/if}
</div>
