import { t } from '@skaro/ui';
import type { ProjectGraph } from './data.svelte';
import type { LiveGraph } from '../graph-preview/live-graph';
import type { PreviewGraph } from '../graph-preview/projection';
import { renderGraph } from './render-data';
import { fullGraph } from './export-data';
import { layoutForExport } from './export-layout';
import { graphPng, type GraphCapture } from './export-png';
import { gexf } from './export-gexf';
import { exportName } from '../diagram-export/image';
import { graphRendererSettings } from '../graph-preview/renderer-settings';
import type { GraphPage } from '@skaro/core/graph-view';

export interface GraphExportSource {
  live: LiveGraph;
  page: GraphPage;
}

function freezeStyle(capture: GraphCapture): void {
  const { graph, settings } = capture;
  capture.effectsGraph = graph.copy() as PreviewGraph;
  graph.forEachNode((id, data) => {
    if (settings.nodeReducer) {
      const reduced = settings.nodeReducer(id, { ...data });
      graph.mergeNodeAttributes(id, {
        ...reduced,
        label: reduced.label === undefined ? data.label : (reduced.label ?? ''),
      });
    }
  });
  graph.forEachEdge((id, data) => {
    if (settings.edgeReducer) graph.mergeEdgeAttributes(id, settings.edgeReducer(id, { ...data }));
  });
}
export async function exportGraph(
  model: ProjectGraph,
  shown: GraphExportSource | undefined,
  format: 'png' | 'gexf',
  all: boolean,
  surface: HTMLElement,
): Promise<void> {
  if (!model.page || !model.snapshot || model.page.snapshotId !== model.snapshot.id)
    throw new Error('graph-snapshot-expired');
  if (!all && shown?.page !== model.page) throw new Error('Graph is not ready');
  const live = shown?.live;
  const scope = model.scope(),
    phase = model.status?.snapshot?.id === model.snapshot.id ? model.status.phase : 'stale';
  let page = model.page,
    snapshot = model.snapshot;
  if (!all && !live) throw new Error('Graph is not ready');
  const source = surface;
  const area =
    surface.querySelector('.graph-canvas')?.getBoundingClientRect() ??
    surface.getBoundingClientRect();
  const dimensions = live?.renderer.getDimensions() ?? { width: area.width, height: area.height };
  const capture: GraphCapture = {
    graph: live ? (live.graph.copy() as PreviewGraph) : renderGraph(page, t('c4.planned')),
    settings: live?.renderer.getSettings() ?? graphRendererSettings(),
    camera: live?.renderer.getCamera().getState() ?? { x: 0.5, y: 0.5, ratio: 1, angle: 0 },
    bbox: live?.renderer.getCustomBBox() ?? null,
    ...dimensions,
    time: performance.now(),
    active: new Set(live?.active),
    past: new Set(live?.past),
    selected: live?.selected ?? '',
    flow: (live?.flow ?? true) && !matchMedia('(prefers-reduced-motion: reduce)').matches,
    ...(live?.playback ? { playback: { ...live.playback } } : {}),
  };
  // Reducers reference the live renderer: freeze their result before any asynchronous work.
  if (format === 'png' && !all) freezeStyle(capture);
  if (all) {
    ({ page, snapshot } = await fullGraph(scope));
    capture.graph = renderGraph(page, t('c4.planned'));
    await layoutForExport(capture.graph);
    capture.active.clear();
    capture.past.clear();
    capture.selected = '';
    capture.playback = undefined;
  }
  const bytes =
    format === 'png'
      ? await graphPng(capture, source, all)
      : gexf(page, snapshot, capture.graph, all ? 'all' : 'current', phase);
  await window.skaro.invoke('diagram.save', {
    name: `${exportName('graph', all ? 'all' : 'view', snapshot.id)}.${format}`,
    format,
    bytes,
  });
}
