import type { GraphPage, GraphSnapshot, GraphPhase } from '@skaro/core/graph-view';
import type { PreviewGraph } from '../graph-preview/projection';
import { EXPORT_MAX_BYTES } from '../../../shared/diagram-export';

// XML 1.0 excludes controls and unpaired surrogates even inside escaped strings.
export function xml(value: unknown): string {
  return (
    String(value ?? '')
      // eslint-disable-next-line no-control-regex -- XML 1.0 permits these whitespace controls only.
      .replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;')
      .replaceAll('\n', '&#10;')
      .replaceAll('\r', '&#13;')
      .replaceAll('\t', '&#9;')
  );
}
function values(attributes: Record<string, unknown>): string {
  return (
    '<attvalues>' +
    Object.entries(attributes)
      .filter(([, value]) => value !== undefined)
      .map(
        ([id, value]) =>
          `<attvalue for="${id}" value="${xml(typeof value === 'object' ? JSON.stringify(value) : value)}"/>`,
      )
      .join('') +
    '</attvalues>'
  );
}
function schema(kind: 'node' | 'edge', keys: string[]): string {
  return `<attributes class="${kind}" mode="static">${keys.map((key) => `<attribute id="${key}" title="${key}" type="string"/>`).join('')}</attributes>`;
}
function color(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Invalid graph export color');
  return `<viz:color r="${parseInt(hex.slice(1, 3), 16)}" g="${parseInt(hex.slice(3, 5), 16)}" b="${parseInt(hex.slice(5, 7), 16)}"/>`;
}
export function gexf(
  page: GraphPage,
  snapshot: GraphSnapshot,
  graph: PreviewGraph,
  scope: 'current' | 'all',
  phase: GraphPhase,
): Uint8Array {
  const metadata = {
    snapshotId: snapshot.id,
    checkoutId: snapshot.checkoutId,
    head: snapshot.head,
    analyzerVersion: snapshot.analyzerVersion,
    createdAt: snapshot.createdAt,
    c4Revision: snapshot.c4Revision,
    c4Hash: snapshot.c4Hash,
    coverage: snapshot.coverage,
    scope,
    phase,
    incomplete: page.incomplete,
    omitted: page.omitted,
    aggregated: page.aggregated,
    hasMore: page.hasMore,
    reason: page.reason,
  };
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gexf xmlns="http://gexf.net/1.3" xmlns:viz="http://gexf.net/1.3" version="1.3">',
    `<meta><creator>Skaro</creator><description>${xml(JSON.stringify(metadata))}</description></meta>`,
    '<graph mode="static" defaultedgetype="directed">',
    schema('node', ['kind', 'origin', 'state', 'qualifiedName', 'sources', 'attributes']),
    schema('edge', ['kind', 'origin', 'state', 'resolution', 'evidence', 'members']),
    '<nodes>',
  ];
  const ids = new Set(page.nodes.map((node) => node.id));
  // Gephi draws node sizes in graph units. Sigma positions span roughly seven units.
  const coordinateScale = Math.max(100, 40 * Math.sqrt(page.nodes.length));
  for (const node of page.nodes) {
    const visual = graph.getNodeAttributes(node.id);
    parts.push(
      `<node id="${xml(node.id)}" label="${xml(node.name)}">`,
      values({
        kind: node.kind,
        origin: node.origin,
        state: node.state,
        qualifiedName: node.qualifiedName,
        sources: node.sources,
        attributes: node.attributes,
      }),
      `<viz:position x="${visual.x * coordinateScale}" y="${visual.y * coordinateScale}" z="0"/><viz:size value="${visual.size}"/>`,
      color(visual.color),
      '</node>',
    );
  }
  parts.push('</nodes><edges>');
  for (const edge of page.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target))
      throw new Error('Dangling graph export edge');
    const visual = graph.getEdgeAttributes(edge.id);
    parts.push(
      `<edge id="${xml(edge.id)}" source="${xml(edge.source)}" target="${xml(edge.target)}" kind="${xml(edge.id)}" label="${xml(edge.label ?? edge.kind)}">`,
      values({
        kind: edge.kind,
        origin: edge.origin,
        state: edge.state,
        resolution: edge.resolution,
        evidence: edge.evidence,
        members: edge.members,
      }),
      color(visual.color),
      `<viz:thickness value="${visual.size}"/>`,
      '</edge>',
    );
  }
  parts.push('</edges></graph></gexf>');
  const bytes = new TextEncoder().encode(parts.join(''));
  if (bytes.length > EXPORT_MAX_BYTES) throw new Error('diagram-export-file-size');
  return bytes;
}
