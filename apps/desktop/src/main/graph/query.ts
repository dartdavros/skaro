import type { GraphPage, GraphQuery, GraphNode, GraphEdge } from '@skaro/core/graph-view';
import type { GraphStore } from './store';
import { assertScope, validateQuery, cursorFor, nodeMatches } from './query-validation';
import { overview } from './overview';
import { cachedOverview } from './overview-cache';
import { traverse } from './traversal';

export function queryGraph(store: GraphStore, query: GraphQuery): GraphPage {
  const snapshot = assertScope(store, query),
    { queryHash, offset, limit } = validateQuery(query);
  let nodes: GraphNode[] = [],
    edges: GraphEdge[] = [],
    aggregated = 0,
    incomplete = false,
    reason: string | undefined,
    path: string[] | undefined;
  if (query.operation === 'overview' || query.operation === 'expand') {
    ({ nodes, edges, aggregated } = cachedOverview(store, query) ?? overview(store, query));
  } else if (query.operation === 'search') {
    const tokens = (query.text ?? '').match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 12) ?? [];
    if (tokens.length) {
      const match = tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' AND ');
      const rows = store.db
        .prepare(
          'SELECT id FROM search WHERE search MATCH ? AND snapshot=? ORDER BY rank,id LIMIT 10001',
        )
        .all(match, snapshot.id) as { id: string }[];
      nodes = store
        .nodes(
          snapshot.id,
          rows.map((row) => row.id),
        )
        .filter((node) => nodeMatches(node, query.filter));
      if (rows.length > 10_000) {
        incomplete = true;
        reason = 'search-budget';
      }
    }
  } else if (query.operation === 'details') {
    if (query.id?.startsWith('group:') || query.id?.startsWith('aggregate:'))
      throw new Error('Expand the projection to inspect its original objects');
    nodes = store.nodes(snapshot.id, query.id ? [query.id] : []);
    if (!nodes.length && query.id) edges = store.edges(snapshot.id, [query.id]);
    if (!nodes.length && !edges.length) throw new Error('Unknown graph object');
  } else {
    const result = traverse(store, query);
    nodes = store.nodes(snapshot.id, result.ids).filter((node) => nodeMatches(node, query.filter));
    edges = store.edges(snapshot.id, result.edges);
    incomplete = result.incomplete;
    reason = result.reason;
    path = result.path;
  }
  const total = nodes.length,
    page = nodes.slice(offset, offset + limit),
    ids = new Set(nodes.slice(0, offset + limit).map((node) => node.id)),
    newIds = new Set(page.map((node) => node.id));
  const eligible =
    query.operation === 'details'
      ? edges
      : edges.filter(
          (edge) =>
            ids.has(edge.source) &&
            ids.has(edge.target) &&
            (newIds.has(edge.source) || newIds.has(edge.target)),
        );
  const pageEdges = eligible.slice(0, 2000),
    hasMore = offset + limit < total;
  const loadedEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).length;
  if (eligible.length > 2000) {
    incomplete = true;
    reason ??= 'edge-page-budget';
  }
  return {
    snapshotId: snapshot.id,
    requestId: query.requestId,
    queryHash,
    nodes: page,
    edges: pageEdges,
    hasMore,
    ...(hasMore ? { cursor: cursorFor(query, queryHash, offset + limit) } : {}),
    totals: {
      nodes:
        query.operation === 'overview' || query.operation === 'expand' ? snapshot.nodes : total,
      edges: edges.length,
    },
    omitted:
      Math.max(0, total - offset - page.length) +
      Math.max(0, edges.length - loadedEdges) +
      Math.max(0, eligible.length - pageEdges.length),
    aggregated,
    incomplete,
    ...(reason ? { reason } : {}),
    ...(path ? { path } : {}),
    ...(query.operation === 'details' && query.id
      ? { unresolved: store.unresolved(snapshot.id, query.id) }
      : {}),
  };
}
