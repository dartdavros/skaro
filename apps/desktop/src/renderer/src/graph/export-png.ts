import Sigma from 'sigma';
import type { Settings } from 'sigma/settings';
import type { CameraState } from 'sigma/types';
import type { PreviewGraph, NodeData, EdgeData } from '../graph-preview/projection';
import { paintEffects } from '../graph-preview/graph-effects';
import { fitGraph } from '../graph-preview/viewport';
import { exportHost, imageSize, painted, pngBytes, canvasBlob } from '../diagram-export/image';

export interface GraphCapture {
  graph: PreviewGraph;
  effectsGraph?: PreviewGraph;
  settings: Settings<NodeData, EdgeData>;
  camera: CameraState;
  bbox: ReturnType<Sigma['getCustomBBox']>;
  width: number;
  height: number;
  time: number;
  active: Set<string>;
  past: Set<string>;
  selected: string;
  flow: boolean;
  playback?: { edgeId: string; progress: number };
}
export async function graphPng(
  capture: GraphCapture,
  source: HTMLElement,
  all: boolean,
): Promise<Uint8Array> {
  const { graph, width, height } = capture;
  const size = imageSize(width, height);
  // Render geometry at 2× as well; enlarging an existing bitmap would blur labels.
  const host = exportHost(source, size.width, size.height);
  const effects = document.createElement('canvas');
  effects.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  let renderer: Sigma<NodeData, EdgeData> | undefined;
  try {
    await document.fonts.ready;
    // Freeze reducers before awaiting or constructing a separate renderer.
    const settings = capture.settings;
    renderer = new Sigma(graph, host, {
      ...settings,
      nodeReducer: null,
      edgeReducer: null,
      stagePadding: settings.stagePadding * 2,
      minEdgeThickness: settings.minEdgeThickness * 2,
      antiAliasingFeather: settings.antiAliasingFeather * 2,
      labelGridCellSize: settings.labelGridCellSize * 2,
      labelRenderedSizeThreshold: settings.labelRenderedSizeThreshold * 2,
      zoomToSizeRatioFunction: (ratio) => settings.zoomToSizeRatioFunction(ratio) / 2,
      defaultDrawNodeLabel: (context, node) => {
        context.save();
        context.scale(2, 2);
        settings.defaultDrawNodeLabel(
          context,
          { ...node, x: node.x / 2, y: node.y / 2, size: node.size / 2 },
          settings,
        );
        context.restore();
      },
    });
    if (!all) {
      renderer.setCustomBBox(capture.bbox);
      renderer.getCamera().setState(capture.camera);
    } else {
      fitGraph(renderer, host);
    }
    effects.style.width = `${width}px`;
    effects.style.height = `${height}px`;
    host.append(effects);
    await painted();
    const output = document.createElement('canvas');
    output.width = size.width;
    output.height = size.height;
    const context = output.getContext('2d');
    if (!context) throw new Error('Canvas export unavailable');
    context.fillStyle = getComputedStyle(source).getPropertyValue('--sk-bg').trim();
    context.fillRect(0, 0, output.width, output.height);
    // WebGL uses preserveDrawingBuffer=false: refresh and read in the same task.
    renderer.refresh();
    for (const layer of Object.values(renderer.getCanvases()))
      context.drawImage(layer, 0, 0, output.width, output.height);
    const projection: Pick<Sigma<NodeData, EdgeData>, 'graphToViewport'> = {
      graphToViewport: (point, options) => {
        const projected = renderer!.graphToViewport(point, options);
        return { x: projected.x / 2, y: projected.y / 2 };
      },
    };
    paintEffects(
      effects,
      projection,
      capture.effectsGraph ?? graph,
      capture.time,
      capture.active,
      capture.selected,
      capture.flow,
      capture.playback,
      capture.past,
      2,
    );
    context.drawImage(effects, 0, 0, output.width, output.height);
    return pngBytes(await canvasBlob(output));
  } finally {
    renderer?.kill();
    host.remove();
  }
}
