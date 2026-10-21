<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { SvelteFlow, MiniMap, useSvelteFlow, getViewportForBounds } from '@xyflow/svelte';
  import { Banner } from '@skaro/ui';
  import LoadingView from '../screens/LoadingView.svelte';
  import type { C4Model, C4View } from '@skaro/core/c4-view';
  import C4NodeView from './C4Node.svelte';
  import C4EdgeView from './C4Edge.svelte';
  import C4CanvasTools from './C4CanvasTools.svelte';
  import type { C4Node, C4Edge, C4Graph } from './graph';
  import { layoutC4 } from './layout';
  import { graphBounds, selectedBounds, loadViewport, saveViewport, viewportKey } from './viewport';
  import '@xyflow/svelte/dist/style.css';
  import '../canvas-background.css';
  import './styles.css';
  let {
    model,
    view,
    selected,
    focusRequest = 0,
    onselect,
    ondrill,
  }: {
    model: C4Model;
    view: C4View;
    selected?: string;
    focusRequest?: number;
    onselect: (id: string) => void;
    ondrill: (id: string) => void;
  } = $props();
  let nodes = $state.raw<C4Node[]>([]),
    edges = $state.raw<C4Edge[]>([]);
  let graph = $state.raw<C4Graph>(),
    error = $state(''),
    loading = $state(true);
  let initialized = $state(false);
  let canvas: HTMLDivElement;
  let width = $state(0),
    height = $state(0);
  const hasSize = $derived(width > 0 && height > 0);
  const flow = useSvelteFlow<C4Node, C4Edge>();
  const nodeTypes = { c4: C4NodeView },
    edgeTypes = { c4: C4EdgeView };
  const key = $derived(viewportKey(model, view.id));
  const stored = $derived(loadViewport(key));
  $effect(() => {
    if (!initialized || !hasSize) return;
    const currentModel = model,
      currentView = view,
      storageKey = key;
    let stale = false;
    loading = true;
    error = '';
    void layoutC4(currentModel, currentView)
      .then(async (placed) => {
        if (stale) return;
        graph = placed;
        nodes = structuredClone(placed.nodes);
        edges = structuredClone(placed.edges);
        await tick();
        if (stale) return;
        const previous = loadViewport(storageKey);
        if (previous) await flow.setViewport(previous);
        else await fit();
        loading = false;
      })
      .catch((reason) => {
        if (!stale) {
          loading = false;
          error = String(reason);
        }
      });
    return () => {
      stale = true;
    };
  });
  async function fit(): Promise<void> {
    if (!graph || !canvas) return;
    const bounds = canvas.getBoundingClientRect();
    await flow.setViewport(
      getViewportForBounds(graphBounds(graph), bounds.width, bounds.height, 0.02, 4, 0.08),
    );
  }
  $effect(() => {
    const id = selected;
    nodes = untrack(() =>
      nodes.map((node) => ({ ...node, selected: node.id === id || node.data.element.id === id })),
    );
  });
  async function focus(): Promise<void> {
    if (!graph || !canvas || !selected) return;
    const bounds = selectedBounds(graph, selected);
    if (!bounds) return;
    const area = canvas.getBoundingClientRect();
    await flow.setViewport(getViewportForBounds(bounds, area.width, area.height, 0.1, 1, 0.5));
  }
  let focused = -1;
  $effect(() => {
    const request = focusRequest;
    if (!loading && request > 0 && request !== focused) {
      focused = request;
      void tick().then(() => untrack(focus));
    }
  });
</script>

<div class="c4-canvas" bind:this={canvas} bind:clientWidth={width} bind:clientHeight={height}>
  {#if error}<Banner kind="error" text={error} />{/if}
  {#if loading}<LoadingView overlay />{/if}
  <SvelteFlow
    class="canvas-dots"
    bind:nodes
    bind:edges
    {nodeTypes}
    {edgeTypes}
    minZoom={0.02}
    maxZoom={4}
    oninit={() => (initialized = true)}
    initialViewport={stored}
    nodesDraggable={false}
    nodesConnectable={false}
    elementsSelectable
    deleteKey={null}
    zoomOnDoubleClick={false}
    onlyRenderVisibleElements
    onnodeclick={({ node, event }) => {
      onselect(node.data.element.id);
      if ('detail' in event && event.detail === 2) ondrill(node.data.element.id);
    }}
    onedgeclick={({ edge }) => edge.data?.relationship && onselect(edge.data.relationship)}
    onselectionchange={({ edges: chosen }) => {
      if (chosen[0]?.data?.relationship) onselect(chosen[0].data.relationship);
    }}
    onmoveend={(_event, viewport) => {
      if (!loading) saveViewport(key, viewport);
    }}
  >
    <MiniMap
      width={144}
      height={96}
      pannable
      zoomable
      position="bottom-right"
      nodeColor={(node) => (node.data?.boundary ? 'transparent' : 'var(--sk-text-label)')}
    />
  </SvelteFlow>
  <C4CanvasTools
    zoom={flow.getZoom()}
    onzoom={(factor) => void flow.setZoom(flow.getZoom() * factor)}
    onfit={() => void fit()}
  />
</div>

<style>
  .c4-canvas {
    position: relative;
  }
</style>
