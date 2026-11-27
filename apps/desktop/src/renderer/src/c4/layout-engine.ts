import ELK, { type ElkNode, type ElkExtendedEdge } from 'elkjs/lib/elk-api.js';
import ELKWorker from 'elkjs/lib/elk-worker.min.js?worker';
import type { C4Graph, C4Node, C4Edge } from './graph';
import { waitForC4 } from './lifetime';

function dynamic(graph: C4Graph): C4Graph {
  const height = Math.max(...graph.nodes.map((n) => n.height ?? 180));
  const nodes = graph.nodes.map((node, i) => ({ ...node, position: { x: i * 320, y: 0 } }));
  const x = new Map(nodes.map((node) => [node.id, node.position.x + (node.width ?? 248) / 2]));
  let bottom = height + 50;
  const edges: C4Edge[] = graph.edges.map((edge) => {
    const labelHeight = edge.data?.labelHeight ?? 44;
    const y = bottom + labelHeight + 28;
    bottom = y + 26;
    return {
      ...edge,
      data: {
        ...edge.data!,
        points: [
          { x: x.get(edge.source)!, y },
          { x: x.get(edge.target)!, y },
        ],
        labelPosition: {
          x: (x.get(edge.source)! + x.get(edge.target)!) / 2,
          y: y - labelHeight / 2 - 8,
        },
      },
    };
  });
  for (const node of nodes)
    edges.unshift({
      id: `life-${node.id}`,
      source: node.id,
      target: node.id,
      type: 'c4',
      selectable: false,
      data: {
        lifeline: true,
        text: '',
        technology: '',
        points: [
          { x: x.get(node.id)!, y: height },
          { x: x.get(node.id)!, y: bottom + 40 },
        ],
      },
    });
  // An invisible semantic-free extent anchors the lower canvas bound, including fit-to-view.
  for (const node of nodes) node.height = height;
  return { nodes, edges };
}

async function layout(graph: C4Graph, signal: AbortSignal): Promise<C4Graph> {
  const elk = new ELK({ workerFactory: () => new ELKWorker() });
  let timeout: ReturnType<typeof setTimeout>;
  const children = (parent?: string): ElkNode[] =>
    graph.nodes
      .filter((n) => n.parentId === parent)
      .map((node) => ({
        id: node.id,
        width: node.width,
        height: node.height,
        ...(graph.nodes.some((n) => n.parentId === node.id)
          ? {
              children: children(node.id),
              layoutOptions: {
                'elk.padding': `[top=${(node.height ?? 71) + 12},left=24,bottom=24,right=24]`,
              },
            }
          : {}),
      }));
  const root = await waitForC4(
    Promise.race([
      Promise.all(
        ['RIGHT', 'DOWN'].map((direction) =>
          elk.layout<ElkNode>({
            id: 'root',
            layoutOptions: {
              'elk.algorithm': 'layered',
              'elk.direction': direction,
              'elk.edgeRouting': 'ORTHOGONAL',
              'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
              'elk.separateConnectedComponents': 'false',
              'elk.spacing.nodeNode': '36',
              'elk.layered.spacing.nodeNodeBetweenLayers': '64',
              'elk.spacing.edgeNode': '20',
              'elk.layered.crossingMinimization.semiInteractive': 'true',
              'elk.layered.nodePlacement.favorStraightEdges': 'true',
              'elk.randomSeed': '1',
            },
            children: children(),
            edges: graph.edges.map((edge) => ({
              id: edge.id,
              sources: [edge.source],
              targets: [edge.target],
              labels: [
                {
                  id: `${edge.id}-label`,
                  text: edge.data!.text,
                  width: 220,
                  height: edge.data!.labelHeight ?? 44,
                },
              ],
            })),
          }),
        ),
      ).then(
        (candidates) =>
          candidates.sort(
            (a, b) =>
              Math.min(1440 / (b.width ?? 1), 800 / (b.height ?? 1)) -
              Math.min(1440 / (a.width ?? 1), 800 / (a.height ?? 1)),
          )[0]!,
      ),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('C4: layout timed out')), 60_000);
      }),
    ]),
    signal,
  ).finally(() => {
    clearTimeout(timeout);
    elk.terminateWorker();
  });
  const placed = new Map<string, ElkNode>();
  const absolute = new Map<string, { x: number; y: number }>();
  const collect = (node: ElkNode, parentX = 0, parentY = 0) => {
    const x = parentX + (node.x ?? 0),
      y = parentY + (node.y ?? 0);
    placed.set(node.id, node);
    absolute.set(node.id, { x, y });
    node.children?.forEach((child) => collect(child, x, y));
  };
  collect(root);
  const routed = new Map<string, { edge: ElkExtendedEdge; x: number; y: number }>();
  const collectEdges = (node: ElkNode) => {
    node.edges?.forEach((edge) => {
      // ELK can keep an edge in root.edges while reporting its coordinates in a
      // nested container. The declared coordinate system owns both route and label.
      const origin = absolute.get(edge.container ?? node.id);
      if (!origin) throw new Error(`C4: unknown route container ${edge.container}`);
      routed.set(edge.id, { edge, ...origin });
    });
    node.children?.forEach(collectEdges);
  };
  collectEdges(root);
  const nodes: C4Node[] = graph.nodes.map((node) => {
    const p = placed.get(node.id)!;
    return {
      ...node,
      position: { x: p.x ?? 0, y: p.y ?? 0 },
      width: p.width!,
      height: p.height!,
      style: `width:${p.width}px;height:${p.height}px;`,
    };
  });
  const edges: C4Edge[] = graph.edges.map((edge) => {
    const route = routed.get(edge.id),
      section = route?.edge.sections?.[0],
      label = route?.edge.labels?.[0];
    if (!section) throw new Error(`C4: layout did not route ${edge.id}`);
    return {
      ...edge,
      data: {
        ...edge.data!,
        points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(
          (point) => ({ x: point.x + route!.x, y: point.y + route!.y }),
        ),
        ...(label
          ? {
              labelPosition: {
                x: (label.x ?? 0) + (label.width ?? 0) / 2 + route!.x,
                y: (label.y ?? 0) + (label.height ?? 44) / 2 + route!.y,
              },
            }
          : {}),
      },
    };
  });
  return { nodes, edges };
}

export async function layoutC4Graph(
  graph: C4Graph,
  isDynamic: boolean,
  signal: AbortSignal,
): Promise<C4Graph> {
  signal.throwIfAborted();
  return isDynamic ? dynamic(graph) : layout(graph, signal);
}
