import type { GraphScope, GraphNode, GraphEdge } from '@skaro/core/graph-view';
import type { GraphExportPage } from '../../shared/diagram-export';
import type { GraphStore } from './store';
import { assertScope } from './query-validation';

/** Caller owns a read transaction, including the snapshot and this page. */
export function exportGraphPage(
  store: GraphStore,
  scope: GraphScope,
  kind: 'nodes' | 'edges',
  after?: string,
  limit = 500,
): GraphExportPage {
  const snapshot = assertScope(store, scope);
  if (
    !['nodes', 'edges'].includes(kind) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 500 ||
    (after !== undefined && (typeof after !== 'string' || after.length > 4000))
  )
    throw new Error('Invalid graph export cursor');
  const rows = store.db
    .prepare(
      `SELECT id,data FROM ${kind} WHERE snapshot=? ${after === undefined ? '' : 'AND id>?'} ORDER BY id LIMIT ?`,
    )
    .all(...(after === undefined ? [snapshot.id, limit + 1] : [snapshot.id, after, limit + 1])) as {
    id: string;
    data: string;
  }[];
  const page = rows.slice(0, limit);
  return {
    snapshot,
    nodes: kind === 'nodes' ? page.map((row) => JSON.parse(row.data) as GraphNode) : [],
    edges: kind === 'edges' ? page.map((row) => JSON.parse(row.data) as GraphEdge) : [],
    ...(rows.length > limit ? { next: page.at(-1)!.id } : {}),
  };
}
