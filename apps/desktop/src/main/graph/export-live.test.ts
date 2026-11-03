import { expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { GraphPage } from '@skaro/core/graph-view';
import { GraphStore } from './store';
import { exportGraphPage } from './export-page';
import { gexf, xml } from '../../renderer/src/graph/export-gexf';
import { renderGraph } from '../../renderer/src/graph/render-data';

const database = process.env['SKARO_GRAPH_VERIFY_DATABASE'];
it.skipIf(!database)(
  'exports the complete real Cat-pilot snapshot, preserving directed edges and evidence',
  async () => {
    const store = new GraphStore(database!, true);
    try {
      store.db.exec('BEGIN');
      const snapshot = store.current()!;
      expect(snapshot.projectId).toBe('78bc2cd3-981b-40ed-a395-c6c6bc7da51b');
      const scope = {
        projectId: snapshot.projectId,
        checkoutId: snapshot.checkoutId,
        snapshotId: snapshot.id,
        requestId: 'export-regression',
      };
      const nodes: GraphPage['nodes'] = [],
        edges: GraphPage['edges'] = [];
      for (const kind of ['nodes', 'edges'] as const) {
        let after: string | undefined;
        do {
          const page = exportGraphPage(store, scope, kind, after, 7);
          expect(page.snapshot).toEqual(snapshot);
          expect(page.nodes.length + page.edges.length).toBeLessThanOrEqual(7);
          if (page.next !== undefined) expect(page.next).not.toBe(after);
          nodes.push(...page.nodes);
          edges.push(...page.edges);
          after = page.next;
        } while (after !== undefined);
      }
      expect(nodes.length).toBe(snapshot.nodes);
      expect(edges.length).toBe(snapshot.edges);
      expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length);
      expect(new Set(edges.map((edge) => edge.id)).size).toBe(edges.length);
      expect(nodes.length).toBeGreaterThan(7); // Exercise pagination with the genuine small project.
      expect(() =>
        exportGraphPage(store, { ...scope, checkoutId: 'wrong-checkout' }, 'nodes'),
      ).toThrow('graph-snapshot-expired');
      expect(() => exportGraphPage(store, scope, 'files' as 'nodes')).toThrow(
        'Invalid graph export cursor',
      );
      const page: GraphPage = {
        snapshotId: snapshot.id,
        requestId: scope.requestId,
        queryHash: 'export',
        nodes,
        edges,
        totals: { nodes: nodes.length, edges: edges.length },
        hasMore: false,
        omitted: 0,
        aggregated: 0,
        incomplete: false,
      };
      const graph = renderGraph(page, 'Планируется');
      const bytes = gexf(page, snapshot, graph, 'all', 'ready');
      const document = new TextDecoder().decode(bytes);
      expect((document.match(/<node /g) ?? []).length).toBe(nodes.length);
      expect((document.match(/<edge /g) ?? []).length).toBe(edges.length);
      expect(document).toContain('defaultedgetype="directed"');
      for (const edge of edges) {
        expect(document).toContain(
          `id="${xml(edge.id)}" source="${xml(edge.source)}" target="${xml(edge.target)}" kind="${xml(edge.id)}"`,
        );
        expect(document).toContain(`for="evidence" value="${xml(JSON.stringify(edge.evidence))}"`);
      }
      const output = process.env['SKARO_GRAPH_EXPORT_PROOF'];
      if (output) {
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, bytes);
      }
      console.log('Real Cat-pilot export:', {
        snapshotId: snapshot.id,
        nodes: nodes.length,
        edges: edges.length,
        bytes: bytes.length,
      });
    } finally {
      store.db.exec('ROLLBACK');
      store.close();
    }
  },
);

it('escapes graph text as XML 1.0 without breaking Unicode labels', () => {
  expect(xml('a\nb\tc\r')).toBe('a&#10;b&#9;c&#13;');
  expect(xml('Кириллица & < > " \' 🐈\u0000\ud800')).toBe(
    'Кириллица &amp; &lt; &gt; &quot; &apos; 🐈',
  );
});
