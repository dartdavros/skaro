<script lang="ts">
  import { SvelteFlow, SvelteFlowProvider } from '@xyflow/svelte';
  import type { C4Graph } from './graph';
  import C4Node from './C4Node.svelte';
  import C4Edge from './C4Edge.svelte';
  import { graphBounds } from './viewport';
  import '@xyflow/svelte/dist/style.css';
  import './styles.css';
  let { graph, onready }: { graph: C4Graph; onready: () => void } = $props();
  const bounds = $derived(graphBounds(graph));
  const nodes = $derived(graph.nodes.map((node) => ({ ...node, selected: false })));
  const edges = $derived(graph.edges.map((edge) => ({ ...edge, selected: false })));
</script>

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
    oninit={onready}
  />
</SvelteFlowProvider>
