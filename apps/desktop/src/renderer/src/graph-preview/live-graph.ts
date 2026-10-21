import Sigma from 'sigma';
import type { PreviewGraph, NodeData, EdgeData } from './projection';
import { drawLabel } from './labels';
import { paintEffects } from './graph-effects';
import { fitGraph } from './viewport';
import LayoutWorker from './layout.worker?worker';
import { createEdgeCurveProgram } from '@sigma/edge-curve';
import { loopAt } from './edge-geometry';
import { LayoutMotion } from './layout-motion';

export class LiveGraph {
  readonly renderer: Sigma<NodeData, EdgeData>;
  motion = true;
  flow = true;
  selected = '';
  selectStructural = false;
  active = new Set<string>();
  past = new Set<string>();
  playback?: { edgeId: string; progress: number };
  onframe?: (delta: number) => void;
  onready?: () => void;
  oncamera?: () => void;
  private readonly selectLoop: (event: PointerEvent) => void;
  private hovered = '';
  private layout: LayoutMotion;
  private worker: Worker;
  private frame = 0;
  private disposed = false;
  private last = 0;
  private elapsed = 0;
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  readonly graph: PreviewGraph;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    graph: PreviewGraph,
    onselect: (id: string) => void,
    onzoom: (ratio: number) => void,
    positions: Record<string, { x: number; y: number }> = {},
  ) {
    this.container = container;
    this.canvas = canvas;
    this.graph = graph;
    graph.forEachNode((id) => {
      if (positions[id]) graph.mergeNodeAttributes(id, positions[id]);
    });
    this.layout = new LayoutMotion(graph);
    this.renderer = new Sigma<NodeData, EdgeData>(graph, container, {
      labelFont: 'Nunito Sans Variable',
      labelSize: 11,
      labelDensity: 0.4,
      labelGridCellSize: 120,
      labelRenderedSizeThreshold: 6.5,
      stagePadding: 32,
      defaultDrawNodeLabel: drawLabel,
      edgeProgramClasses: {
        curved: createEdgeCurveProgram<NodeData, EdgeData>({
          arrowHead: {
            extremity: 'target',
            lengthToThicknessRatio: 2.5,
            widenessToThicknessRatio: 2,
          },
        }),
      },
      renderEdgeLabels: false,
      enableEdgeEvents: true,
      minCameraRatio: 0.12,
      maxCameraRatio: 3,
      zIndex: true,
      nodeReducer: (id, attributes) => {
        const focus = this.hovered || this.selected;
        const neighbor =
          focus && graph.hasNode(focus) && (id === focus || graph.areNeighbors(id, focus));
        const participant = [...this.active].some(
          (edge) => graph.hasEdge(edge) && graph.extremities(edge).includes(id),
        );
        return {
          ...attributes,
          color:
            this.active.size && !participant
              ? '#404047'
              : focus && graph.hasNode(focus) && !neighbor
                ? '#404047'
                : attributes.color,
          label:
            this.active.size && !participant && !neighbor
              ? ''
              : focus && graph.hasNode(focus) && !neighbor
                ? ''
                : attributes.label,
          forceLabel: participant || !!neighbor || attributes.forceLabel,
          size: participant || id === focus ? attributes.size + 2 : attributes.size,
          zIndex: id === focus ? 3 : neighbor ? 2 : 0,
        };
      },
      edgeReducer: (id, attributes) => {
        const focus = this.hovered || this.selected;
        const adjacent = focus && graph.hasNode(focus) && graph.extremities(id).includes(focus);
        return {
          ...attributes,
          color:
            this.active.has(id) || id === this.selected
              ? '#cfb888'
              : adjacent
                ? graph.getNodeAttribute(graph.source(id), 'color')
                : focus
                  ? '#303036'
                  : this.past.has(id)
                    ? '#645a45'
                    : attributes.color,
          size:
            this.active.has(id) || id === this.selected ? 1.8 : adjacent ? 1.2 : attributes.size,
        };
      },
    });
    this.renderer.on('clickNode', ({ node }) => onselect(node));
    this.renderer.on('clickEdge', ({ edge }) => {
      if (this.selectStructural || !graph.getEdgeAttribute(edge, 'structural')) onselect(edge);
    });
    this.renderer.on('clickStage', () => onselect(''));
    this.renderer.on('enterNode', ({ node }) => {
      this.hovered = node;
      this.renderer.refresh();
    });
    this.renderer.on('leaveNode', () => {
      this.hovered = '';
      this.renderer.refresh();
    });
    this.renderer.getCamera().on('updated', () => {
      onzoom(1 / this.renderer.getCamera().ratio);
      this.oncamera?.();
    });
    this.selectLoop = (event) => {
      const rect = container.getBoundingClientRect(),
        edge = loopAt(this.renderer, graph, {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      if (edge) {
        event.stopImmediatePropagation();
        event.preventDefault();
        onselect(edge);
      }
    };
    container.addEventListener('pointerdown', this.selectLoop, true);
    this.worker = new LayoutWorker();
    this.worker.onmessage = (event: MessageEvent<{ id: string; x: number; y: number }[]>) => {
      if (this.disposed) return;
      this.layout.target(event.data);
      if (this.reduced.matches) this.layout.step(0, true);
      const all = [...event.data, ...graph.mapNodes((_id, node) => node)],
        xs = all.map((p) => p.x),
        ys = all.map((p) => p.y);
      const span = Math.max(
        1,
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
      );
      const pad = span * 0.05;
      this.renderer.setCustomBBox({
        x: [Math.min(...xs) - pad, Math.max(...xs) + pad],
        y: [Math.min(...ys) - pad, Math.max(...ys) + pad],
      });
      this.fit();
      this.container.dataset.layoutReady = 'true';
      this.onready?.();
      this.worker.terminate();
    };
    this.worker.postMessage({
      nodes: graph.mapNodes((id, a) => ({ id, x: a.x, y: a.y, group: a.group })),
      edges: graph.mapEdges((id, _a, source, target) => ({ id, source, target })),
    });
    this.frame = requestAnimationFrame(this.animate);
    document.addEventListener('visibilitychange', this.visibility);
  }
  select(id: string): void {
    this.selected = id;
    this.renderer.refresh();
  }
  positions(): Record<string, { x: number; y: number }> {
    return this.layout.positions();
  }
  focus(id: string): void {
    if (!this.graph.hasNode(id)) return;
    const point = this.renderer.getNodeDisplayData(id)!;
    void this.renderer
      .getCamera()
      .animate(
        { x: point.x, y: point.y, ratio: 0.45 },
        { duration: this.reduced.matches ? 0 : 300 },
      );
  }
  fit(): void {
    fitGraph(this.renderer, this.container);
  }
  zoom(factor: number): void {
    void this.renderer
      .getCamera()
      .animate({ ratio: this.renderer.getCamera().ratio / factor }, { duration: 160 });
  }
  private visibility = (): void => {
    this.last = 0;
  };
  private animate = (now: number): void => {
    if (this.disposed) return;
    if (!document.hidden && now - this.last > 30) {
      const delta = this.last ? Math.min(60, now - this.last) : 0;
      this.last = now;
      this.onframe?.(delta);
      if (this.reduced.matches) this.layout.step(0, true);
      else if (this.motion && this.layout.step(delta)) {
        this.elapsed += delta;
        this.container.dataset.motionFrame = String(Math.round(this.elapsed));
      }
      this.container.dataset.layoutMoving = String(this.layout.moving);
      paintEffects(
        this.canvas,
        this.renderer,
        this.graph,
        now,
        this.active,
        this.hovered || this.selected,
        this.flow && !this.reduced.matches,
        this.playback,
        this.past,
      );
    }
    this.frame = requestAnimationFrame(this.animate);
  };
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.worker.terminate();
    document.removeEventListener('visibilitychange', this.visibility);
    this.container.removeEventListener('pointerdown', this.selectLoop, true);
    this.renderer.kill();
  }
}
