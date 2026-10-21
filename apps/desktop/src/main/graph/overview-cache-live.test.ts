import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import type { GraphQuery, GraphViewState } from '@skaro/core/graph-view';
import { GraphStore } from './store';
import { overview } from './overview';
import { cachedOverview } from './overview-cache';
import { queryGraph } from './query';

const database = process.env['SKARO_GRAPH_VERIFY_DATABASE'];
const settings = process.env['SKARO_GRAPH_VERIFY_SETTINGS'];

it.skipIf(!database || !settings)(
  'reuses the real overview for saved descendants of a collapsed group without losing expansions',
  () => {
    const store = new GraphStore(database!, true);
    const registry = new DatabaseSync(settings!, { readOnly: true });
    try {
      const snapshot = store.current()!;
      const row = registry
        .prepare('SELECT value FROM settings WHERE key=?')
        .get(`graph.view.${snapshot.projectId}`) as { value: string };
      const saved = JSON.parse(row.value) as GraphViewState;
      expect(saved.expanded.length).toBeGreaterThan(0);
      const query: GraphQuery = {
        projectId: snapshot.projectId,
        checkoutId: snapshot.checkoutId,
        snapshotId: snapshot.id,
        requestId: 'saved-overview-regression',
        operation: 'overview',
        filter: saved.filter,
        expanded: saved.expanded,
      };
      const before = JSON.stringify(saved);
      const cached = cachedOverview(store, query);
      expect(cached).toBeDefined();
      // Compare all original objects, relationships, evidence and member counts against
      // the genuine full projection, rather than substituting a generated graph.
      expect(cached).toEqual(overview(store, query));
      const start = performance.now();
      const restored = queryGraph(store, query);
      const ms = performance.now() - start;
      expect(ms).toBeLessThan(1500);
      const collapsed = queryGraph(store, { ...query, expanded: [] });
      expect({ ...restored, queryHash: '' }).toEqual({ ...collapsed, queryHash: '' });
      expect(JSON.stringify(saved)).toBe(before);
      console.log('Working-profile saved overview:', {
        ms,
        nodes: restored.nodes.length,
        edges: restored.edges.length,
        expanded: saved.expanded,
      });

      const group = cached!.nodes.find((node) => node.id === 'group:apps/backend')!;
      expect(group).toBeDefined();
      const expanded = { ...query, expanded: [...saved.expanded, group.id] };
      expect(cachedOverview(store, expanded)).toBeUndefined();
      expect(
        cachedOverview(store, { ...query, operation: 'expand', id: group.id }),
      ).toBeUndefined();
      const opened = queryGraph(store, expanded);
      expect(opened.nodes.some((node) => node.id === group.id)).toBe(false);
      expect(opened.nodes.some((node) => node.id.startsWith(`${group.id}/`))).toBe(true);
      expect(cachedOverview(store, { ...query, filter: { state: 'all' } })).toBeUndefined();
      expect(cachedOverview(store, { ...query, filter: { kinds: ['file'] } })).toBeUndefined();
    } finally {
      registry.close();
      store.close();
    }
  },
  60_000,
);
