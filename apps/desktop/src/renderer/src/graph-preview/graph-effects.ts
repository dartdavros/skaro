import type Sigma from 'sigma';
import type { PreviewGraph, NodeData, EdgeData } from './projection';
import { drawLoop, edgePoint } from './edge-geometry';

export function paintEffects(
  canvas: HTMLCanvasElement,
  renderer: Pick<Sigma<NodeData, EdgeData>, 'graphToViewport'>,
  graph: PreviewGraph,
  time: number,
  active: Set<string>,
  selected: string,
  flow: boolean,
  playback?: { edgeId: string; progress: number },
  past = new Set<string>(),
  pixelRatio = Math.min(devicePixelRatio || 1, 2),
): void {
  const context = canvas.getContext('2d')!;
  const rect = canvas.getBoundingClientRect(),
    ratio = pixelRatio;
  if (
    canvas.width !== Math.round(rect.width * ratio) ||
    canvas.height !== Math.round(rect.height * ratio)
  ) {
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  graph.forEachNode((id, node) => {
    const point = renderer.graphToViewport(node);
    if (point.x < 0 || point.x > rect.width || point.y < 0 || point.y > rect.height) return;
    const chosen = id === selected,
      radius = chosen ? 29 : node.size > 9 ? 21 : 9;
    const gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    gradient.addColorStop(0, node.color + (chosen ? '55' : '25'));
    gradient.addColorStop(1, node.color + '00');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    if (chosen) {
      context.strokeStyle = node.color + 'a0';
      context.lineWidth = 1;
      context.beginPath();
      context.arc(point.x, point.y, node.size + 5, 0, Math.PI * 2);
      context.stroke();
    }
    if (node.planned) {
      context.setLineDash([2, 2]);
      context.strokeStyle = node.color;
      context.lineWidth = 1;
      context.beginPath();
      context.arc(point.x, point.y, node.size + 4, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    }
  });
  graph.forEachEdge((id, edge, source, target) => {
    if (source === target)
      drawLoop(
        context,
        renderer,
        graph,
        id,
        active.has(id) || selected === id ? '#cfb888' : past.has(id) ? '#645a45' : edge.color,
        active.has(id) ? 1.8 : edge.size,
      );
  });
  if (!flow) return;
  graph.forEachEdge((id, edge, source, target) => {
    if (edge.structural) return;
    if (playback && id !== playback.edgeId) return;
    if (active.size && !active.has(id)) return;
    if (!active.size && graph.hasNode(selected) && source !== selected && target !== selected)
      return;
    if (!active.size && edge.ordinal % 3 === 1) return;
    if (!active.size && edge.ordinal % Math.max(1, Math.ceil(graph.size / 300))) return;
    const from = graph.getNodeAttributes(source),
      to = graph.getNodeAttributes(target);
    const a = renderer.graphToViewport(from),
      b = renderer.graphToViewport(to);
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    if (length < 18 && source !== target) return;
    const progress =
      playback?.progress ??
      (time * 0.00009 * (1 + (edge.ordinal % 3) * 0.11) + edge.ordinal * 0.618) % 1;
    const start = Math.max(0, progress - 0.07),
      end = Math.min(1, progress + 0.009);
    const tail = edgePoint(renderer, graph, id, start),
      head = edgePoint(renderer, graph, id, end),
      point = edgePoint(renderer, graph, id, progress);
    const gradient = context.createLinearGradient(tail.x, tail.y, head.x, head.y);
    const color = active.size ? '#d8c59a' : from.color;
    gradient.addColorStop(0, color + '00');
    gradient.addColorStop(0.8, color + (active.size ? 'b0' : '70'));
    gradient.addColorStop(1, color + 'ef');
    context.strokeStyle = gradient;
    context.lineWidth = active.size ? 2.2 : 1.2;
    context.beginPath();
    context.moveTo(tail.x, tail.y);
    for (let index = 1; index <= 5; index++) {
      const sample = edgePoint(renderer, graph, id, start + ((end - start) * index) / 5);
      context.lineTo(sample.x, sample.y);
    }
    context.stroke();
    context.fillStyle = color;
    context.shadowBlur = active.size ? 8 : 3;
    context.shadowColor = color;
    context.beginPath();
    context.arc(point.x, point.y, active.size ? 2.2 : 1.4, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
  });
}
