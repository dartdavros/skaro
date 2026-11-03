<script lang="ts">
  import { SvelteFlow, SvelteFlowProvider } from '@xyflow/svelte';
  import type { C4Graph } from './graph';
  import C4Node from './C4Node.svelte';
  import C4Edge from './C4Edge.svelte';
  import { graphBounds } from './viewport';
  import '@xyflow/svelte/dist/style.css';
  import './styles.css';
  let { graph, onready }: { graph: C4Graph; onready: () => void } = $props();
  let root: HTMLDivElement;
  let active = true;
  import { onDestroy } from 'svelte';
  onDestroy(() => {
    active = false;
  });
  async function waitForScene(): Promise<void> {
    while (active) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!active) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>('.svelte-flow__node'));
      const edges = root.querySelectorAll('.svelte-flow__edge-path');
      if (
        nodes.length === graph.nodes.length &&
        nodes.every((node) => getComputedStyle(node).visibility === 'visible') &&
        edges.length === graph.edges.length
      ) {
        onready();
        return;
      }
    }
  }
  const bounds = $derived(graphBounds(graph));
  const nodes = $derived(graph.nodes.map((node) => ({ ...node, selected: false })));
  const edges = $derived(graph.edges.map((edge) => ({ ...edge, selected: false })));
</script>

<div bind:this={root} style="width:100%;height:100%">
  <SvelteFlowProvider>
    <SvelteFlow
      {nodes}
      {edges}
      nodeTypes={{ c4: C4Node }}
      edgeTypes={{ c4: C4Edge }}
      initialViewport={{ x: -bounds.x, y: -bounds.y, zoom: 1 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      onlyRenderVisibleElements={false}
      oninit={() => void waitForScene()}
    />
  </SvelteFlowProvider>
</div>
