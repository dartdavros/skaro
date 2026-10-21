<script lang="ts">
  import { untrack } from 'svelte';
  import { Banner, Button, t } from '@skaro/ui';
  import type { GraphPage } from '@skaro/core/graph-view';
  import C4CanvasTools from '../c4/C4CanvasTools.svelte';
  import { LiveGraph } from '../graph-preview/live-graph';
  import { renderGraph } from './render-data';
  import LoadingView from '../screens/LoadingView.svelte';
  import type { ProjectGraph } from './data.svelte';
  import '../canvas-background.css';
  let {
    page,
    model,
    motion,
    flow,
  }: { page: GraphPage; model: ProjectGraph; motion: boolean; flow: boolean } = $props();
  let host = $state<HTMLDivElement>(),
    effects = $state<HTMLCanvasElement>();
  let live = $state.raw<LiveGraph>(),
    error = $state(''),
    zoom = $state(1),
    retry = $state(0),
    layoutReady = $state(false);
  let appliedFocus = -1;
  $effect(() => {
    if (live) {
      live.motion = motion;
      live.flow = flow;
      live.select(model.selected);
    }
  });
  $effect(() => {
    const id = model.focus;
    const request = model.focusRequest;
    if (layoutReady && id && request !== appliedFocus && live?.graph.hasNode(id)) {
      appliedFocus = request;
      live.focus(id);
    }
  });
  $effect(() => {
    const data = page,
      container = host,
      overlay = effects;
    void retry;
    if (!container || !overlay || !data.nodes.length) return;
    return untrack(() => {
      let renderer: LiveGraph | undefined,
        ready = false,
        previousActive = '';
      const camera = model.camera;
      container.dataset.layoutReady = 'false';
      layoutReady = false;
      try {
        const graph = renderGraph(data, t('c4.planned'));
        renderer = new LiveGraph(
          container,
          overlay,
          graph,
          (id) => {
            void model.select(id);
          },
          (value) => (zoom = value),
          model.positions,
        );
        const current = renderer;
        live = current;
        current.selectStructural = true;
        current.onready = () => {
          if (camera) current.renderer.getCamera().setState(camera);
          ready = true;
          layoutReady = true;
          model.positions = Object.fromEntries(
            Object.entries({ ...model.positions, ...current.positions() }).slice(-5000),
          );
          model.persist();
        };
        current.oncamera = () => {
          if (ready) {
            model.camera = current.renderer.getCamera().getState();
            model.persist();
          }
        };
        current.onframe = (delta) => {
          model.playback.tick(delta);
          const playback = model.playback,
            step = playback.step;
          const edgeId = (id: string) =>
            playback.scenario?.state === 'planned' && graph.hasEdge(`c4:planned:${id}`)
              ? `c4:planned:${id}`
              : `c4:${id}`;
          const active =
            step && playback.phase !== 'error' ? [edgeId(step.relationshipId)] : model.highlighted;
          const key = active.join('\0') + ':' + playback.index;
          current.playback =
            step && playback.phase !== 'error'
              ? { edgeId: edgeId(step.relationshipId), progress: playback.progress }
              : undefined;
          if (key !== previousActive) {
            previousActive = key;
            current.active = new Set(active);
            current.past = new Set(
              playback.scenario?.steps
                .slice(0, playback.index)
                .map((step) => edgeId(step.relationshipId)) ?? [],
            );
            current.renderer.refresh();
          }
          container.dataset.playbackStep = String(playback.index + 1);
          container.dataset.playbackPhase = playback.phase;
        };
        error = '';
      } catch (reason) {
        error = String(reason);
        model.playback.pause();
      }
      const lost = (event: Event) => {
        event.preventDefault();
        model.playback.pause();
        error = t('graph.webglLost');
      };
      container.addEventListener('webglcontextlost', lost, true);
      return () => {
        container.removeEventListener('webglcontextlost', lost, true);
        renderer?.dispose();
        live = undefined;
      };
    });
  });
</script>

<div
  class="graph-canvas canvas-dots"
  data-node-count={page.nodes.length}
  data-edge-count={page.edges.length}
>
  <div class="sigma-host" bind:this={host} role="img" aria-label={t('graph.canvas')}></div>
  <canvas class="graph-effects" bind:this={effects} aria-hidden="true"></canvas>
  {#if error}<div class="graph-error">
      <Banner kind="error" text={error} /><Button size="sm" onclick={() => retry++}
        >{t('graph.retry')}</Button
      >
    </div>
  {:else if !page.nodes.length}<div class="graph-error">
      <Banner kind="info" text={t('graph.noData')} />
    </div>
  {:else if !layoutReady}<LoadingView overlay />{/if}
  <C4CanvasTools
    {zoom}
    min={1 / 3}
    max={1 / 0.12}
    onzoom={(factor) => live?.zoom(factor)}
    onfit={() => live?.fit()}
  />
</div>
