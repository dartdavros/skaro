import type { GraphNode, GraphEdge, GraphScope, GraphSnapshot } from '@skaro/core/graph-view';

export const EXPORT_MAX_BYTES = 64 * 1024 * 1024;
export const EXPORT_MAX_SIDE = 16384;
export const EXPORT_MAX_PIXELS = 32 * 1024 * 1024;
export interface GraphExportPage {
  snapshot: GraphSnapshot;
  nodes: GraphNode[];
  edges: GraphEdge[];
  next?: string;
}
export interface DiagramExportMethods {
  'diagram.save': (file: { name: string; format: 'png' | 'gexf'; bytes: Uint8Array }) => boolean;
  'diagram.pickFolder': () => string | null;
  'diagram.saveInFolder': (token: string, name: string, bytes: Uint8Array) => void;
  'diagram.closeFolder': (token: string) => void;
  'graph.exportPage': (
    scope: GraphScope,
    kind: 'nodes' | 'edges',
    after?: string,
  ) => GraphExportPage;
}
