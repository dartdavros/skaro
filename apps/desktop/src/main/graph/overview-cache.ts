import type { GraphQuery } from '@skaro/core/graph-view';
import type { GraphStore } from './store';
import type { overview } from './overview';

/** Expansions below collapsed groups cannot change the default projection. */
export function cachedOverview(
  store: GraphStore,
  query: GraphQuery,
): ReturnType<typeof overview> | undefined {
  if (
    !Object.entries(query.filter ?? {}).every(([key, value]) =>
      key === 'state' ? value === 'current' : !value || (Array.isArray(value) && !value.length),
    )
  )
    return;
  const cached = store.meta<ReturnType<typeof overview>>(`overview:${query.snapshotId}`);
  if (!cached) return;
  const expanded = new Set(query.expanded ?? []);
  if (query.operation === 'expand' && query.id) expanded.add(query.id);
  // A group must be visible before its expansion can reveal any of its children.
  // Keep saved descendant expansions intact: they take effect when its ancestors open.
  if (cached.nodes.some((node) => expanded.has(node.id))) return;
  return cached;
}
