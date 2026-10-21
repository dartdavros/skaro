<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { TooltipHost } from '@skaro/ui';
  import type { SourceRef } from '@skaro/core/graph-view';
  import { ProjectGraph } from './data.svelte';
  import { openGraphTarget } from './navigation-target';
  import GraphHeader from './GraphHeader.svelte';
  import GraphPlayback from './GraphPlayback.svelte';
  import GraphLegend from './GraphLegend.svelte';
  import GraphCanvas from './GraphCanvas.svelte';
  import GraphDetails from './GraphDetails.svelte';
  import GraphFooter from './GraphFooter.svelte';
  import GraphStatus from './GraphStatus.svelte';
  import GraphSource from './GraphSource.svelte';
  import LoadingView from '../screens/LoadingView.svelte';
  import './i18n';
  import '../c4/viewer.css';
  import '../graph-preview/preview.css';
  import './graph.css';
  let {
    projectId,
    target,
    onc4,
    ondoc,
    ontask,
  }: {
    projectId: string;
    target?: { elementId: string; viewId?: string } | undefined;
    onc4: (view: string, element?: string) => void;
    ondoc: (path: string) => void;
    ontask: (id: string) => void;
  } = $props();
  // svelte-ignore state_referenced_locally
  const model = new ProjectGraph(projectId);
  let surface: HTMLDivElement,
    motion = $state(true),
    flow = $state(true),
    fullscreen = $state(false);
  let source = $state.raw<{ path: string; text: string; line: number }>();
  let handledTarget = '';
  $effect(() => {
    if (!target || !model.page || !model.snapshot || model.page.snapshotId !== model.snapshot.id)
      return;
    const key = `${target.elementId}:${target.viewId ?? ''}`;
    if (handledTarget === key) return;
    handledTarget = key;
    void openGraphTarget(model, target).catch((error) => (model.error = String(error)));
  });
  $effect(() => {
    void model.playback.index;
    void model.playback.speed;
    model.persist();
  });
  onMount(() => {
    void model.start();
    const visibility = () => {
      if (document.hidden) model.playback.pause();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  });
  onDestroy(() => model.dispose());
  async function openSource(ref: SourceRef): Promise<void> {
    try {
      source = await model.source(ref);
    } catch (error) {
      model.error = String(error);
    }
  }
  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await surface.requestFullscreen();
    } catch (error) {
      model.error = String(error);
    }
  }
</script>

<svelte:document onfullscreenchange={() => (fullscreen = document.fullscreenElement === surface)} />
<div class="c4-viewer graph-preview graph-workspace" bind:this={surface} data-project-graph>
  <GraphHeader
    {model}
    {motion}
    onpause={() => {
      motion = !motion;
      flow = motion;
    }}
    onfullscreen={() => {
      void toggleFullscreen();
    }}
  />
  <GraphPlayback player={model.playback} onchanged={() => model.persist()} />
  <GraphLegend bind:motion bind:flow />
  <GraphStatus {model} />
  {#if model.page}<div class="content">
      <GraphCanvas page={model.page} {model} {motion} {flow} />
      {#if model.selected}<GraphDetails
          {model}
          onsource={(ref) => {
            void openSource(ref);
          }}
          {onc4}
          {ondoc}
          {ontask}
        />{/if}
    </div>
  {:else if !model.error && !['error', 'unavailable', 'cancelled'].includes(model.status?.phase ?? '')}
    <LoadingView />
  {/if}
  <GraphFooter {model} />
  {#if fullscreen}<TooltipHost />{/if}
</div>
{#if source}<GraphSource {source} onclose={() => (source = undefined)} />{/if}
