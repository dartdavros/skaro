import type Sigma from 'sigma';
import type { PreviewGraph, NodeData, EdgeData } from './projection';
type Point = { x: number; y: number };

export function edgePoint(
  renderer: Pick<Sigma<NodeData, EdgeData>, 'graphToViewport'>,
  graph: PreviewGraph,
  id: string,
  progress: number,
): Point {
  const [source, target] = graph.extremities(id),
    edge = graph.getEdgeAttributes(id);
  const a = renderer.graphToViewport(graph.getNodeAttributes(source)),
    b = renderer.graphToViewport(graph.getNodeAttributes(target));
  const t = progress,
    u = 1 - t;
  if (source === target) {
    const offset = 38 + (edge.loopIndex ?? 0) * 12,
      size = graph.getNodeAttribute(source, 'size');
    return {
      x:
        u ** 3 * (a.x + size) +
        3 * u * u * t * (a.x + offset) +
        3 * u * t * t * (a.x - offset) +
        t ** 3 * (a.x - size),
      y:
        u ** 3 * (a.y - 3) +
        3 * u * u * t * (a.y - offset * 1.5) +
        3 * u * t * t * (a.y - offset * 1.5) +
        t ** 3 * (a.y - 3),
    };
  }
  const curvature = edge.curvature ?? 0;
  const control = {
    x: (a.x + b.x) / 2 + (b.y - a.y) * curvature,
    y: (a.y + b.y) / 2 - (b.x - a.x) * curvature,
  };
  return {
    x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
  };
}
export function drawLoop(
  context: CanvasRenderingContext2D,
  renderer: Pick<Sigma<NodeData, EdgeData>, 'graphToViewport'>,
  graph: PreviewGraph,
  id: string,
  color: string,
  width: number,
): void {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  for (let index = 0; index <= 30; index++) {
    const point = edgePoint(renderer, graph, id, index / 30);
    if (!index) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.stroke();
  const end = edgePoint(renderer, graph, id, 1),
    before = edgePoint(renderer, graph, id, 0.97),
    angle = Math.atan2(end.y - before.y, end.x - before.x);
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - 7 * Math.cos(angle - 0.45), end.y - 7 * Math.sin(angle - 0.45));
  context.lineTo(end.x - 7 * Math.cos(angle + 0.45), end.y - 7 * Math.sin(angle + 0.45));
  context.fill();
}
export function loopAt(
  renderer: Sigma<NodeData, EdgeData>,
  graph: PreviewGraph,
  point: Point,
): string | undefined {
  return graph.findEdge((id, _edge, source, target) => {
    if (source !== target) return false;
    for (let index = 1; index < 30; index++) {
      const sample = edgePoint(renderer, graph, id, index / 30);
      if (Math.hypot(sample.x - point.x, sample.y - point.y) < 6) return true;
    }
    return false;
  });
}
