import type { GraphPage, GraphSnapshot, GraphScope } from '@skaro/core/graph-view';
import { EXPORT_MAX_BYTES } from '../../../shared/diagram-export';

export async function fullGraph(
  scope: GraphScope,
): Promise<{ page: GraphPage; snapshot: GraphSnapshot }> {
  const nodes: GraphPage['nodes'] = [],
    edges: GraphPage['edges'] = [];
  let snapshot: GraphSnapshot | undefined,
    size = 0;
  for (const kind of ['nodes', 'edges'] as const) {
    let after: string | undefined;
    do {
      const result = await window.skaro.invoke('graph.exportPage', scope, kind, after);
      if (result.snapshot.id !== scope.snapshotId) throw new Error('graph-snapshot-expired');
      snapshot = result.snapshot;
      size += JSON.stringify(result.nodes).length + JSON.stringify(result.edges).length;
      if (
        size > EXPORT_MAX_BYTES ||
        nodes.length + result.nodes.length > 100000 ||
        edges.length + result.edges.length > 500000
      )
        throw new Error('diagram-export-file-size');
      nodes.push(...result.nodes);
      edges.push(...result.edges);
      if (result.next !== undefined && result.next === after)
        throw new Error('Invalid graph export cursor');
      after = result.next;
    } while (after !== undefined);
  }
  if (!snapshot || nodes.length !== snapshot.nodes || edges.length !== snapshot.edges)
    throw new Error('Graph export snapshot count mismatch');
  return {
    snapshot,
    page: {
      snapshotId: snapshot.id,
      requestId: scope.requestId,
      queryHash: 'full-export',
      nodes,
      edges,
      hasMore: false,
      omitted: 0,
      aggregated: 0,
      incomplete: false,
      totals: { nodes: nodes.length, edges: edges.length },
    },
  };
}
