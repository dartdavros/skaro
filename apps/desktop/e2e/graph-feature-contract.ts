import { expect, type Page } from '@playwright/test';
import type { C4Model } from '@skaro/core/c4-view';
import type { GraphStatus } from '@skaro/core/graph-view';
import type { SkaroApi } from '../src/shared/ipc';
declare const window: Window & { skaro: SkaroApi };

/** Exercise the real IPC, workers and published index; no substitute responses. */
export async function verifyGraphContract(page: Page, status: GraphStatus, accepted: C4Model) {
  const result = await page.evaluate(
    async ({ status, accepted }) => {
      const scope = {
        projectId: status.projectId,
        checkoutId: status.snapshot!.checkoutId,
        snapshotId: status.snapshot!.id,
        requestId: crypto.randomUUID(),
      };
      const scenarios = await window.skaro.invoke('graph.scenarios', scope);
      const http = await window.skaro.invoke('graph.query', {
        ...scope,
        operation: 'search',
        text: 'support-report',
        filter: { kinds: ['endpoint'] },
        limit: 100,
      });
      let clientRoute = false;
      for (const client of http.nodes.filter((node) => node.attributes.request === true)) {
        const neighbors = await window.skaro.invoke('graph.query', {
          ...scope,
          operation: 'neighbors',
          id: client.id,
          direction: 'out',
          depth: 1,
          filter: { resolutions: ['inferred'] },
        });
        if (neighbors.nodes.some((node) => node.attributes.framework === 'django')) {
          clientRoute = true;
          break;
        }
      }
      const model = await window.skaro.invoke('graph.model', scope);
      const ref = (
        await window.skaro.invoke('graph.query', {
          ...scope,
          operation: 'details',
          id: `c4:${accepted.elements.find((element) => element.state === 'current')!.id}`,
        })
      ).nodes[0]!.sources[0]!;
      const source = await window.skaro.invoke('graph.source', scope, ref);
      const rejects = async (action: () => Promise<unknown>) => {
        try {
          await action();
          return false;
        } catch {
          return true;
        }
      };
      const invalidScope = await rejects(() =>
        window.skaro.invoke('graph.query', {
          ...scope,
          checkoutId: 'wrong-checkout',
          operation: 'overview',
        }),
      );
      const staleSource = await rejects(() =>
        window.skaro.invoke('graph.source', scope, { ...ref, contentHash: 'changed' }),
      );
      const excludedSource = await rejects(() =>
        window.skaro.invoke('graph.source', scope, { ...ref, path: '.env' }),
      );
      const outsideSource = await rejects(() =>
        window.skaro.invoke('graph.source', scope, { ...ref, path: '../outside.txt' }),
      );
      const relation = accepted.relationships.find(
        (edge) => edge.state === 'current' && edge.source !== edge.target,
      )!;
      const path = await window.skaro.invoke('graph.query', {
        ...scope,
        operation: 'path',
        id: `c4:${relation.source}`,
        target: `c4:${relation.target}`,
        depth: 1,
        filter: { edges: ['interacts'] },
      });
      const first = await window.skaro.invoke('graph.query', {
        ...scope,
        operation: 'overview',
        limit: 10,
      });
      const second = first.cursor
        ? await window.skaro.invoke('graph.query', {
            ...scope,
            operation: 'overview',
            limit: 10,
            cursor: first.cursor,
          })
        : null;
      const foreignCursor = first.cursor
        ? await rejects(() =>
            window.skaro.invoke('graph.query', {
              ...scope,
              operation: 'overview',
              limit: 10,
              cursor: first.cursor,
              filter: { state: 'planned' },
            }),
          )
        : false;
      return {
        scenarios,
        clientRoute,
        model,
        source,
        invalidScope,
        staleSource,
        excludedSource,
        outsideSource,
        path,
        first,
        second,
        foreignCursor,
      };
    },
    { status, accepted },
  );
  expect(result.model?.revision).toBe(accepted.revision);
  expect(result.clientRoute).toBe(true);
  expect(JSON.parse(result.source.text).revision).toBe(accepted.revision);
  expect([
    result.invalidScope,
    result.staleSource,
    result.excludedSource,
    result.outsideSource,
    result.foreignCursor,
  ]).toEqual([true, true, true, true, true]);
  const dynamic = accepted.views.filter((view) => view.kind === 'dynamic');
  expect(result.scenarios).toHaveLength(dynamic.length);
  for (const scenario of result.scenarios) {
    expect(scenario.diagnostics).toEqual([]);
    expect(scenario.steps.map((step) => step.relationshipId)).toEqual(
      dynamic.find((view) => view.id === scenario.viewId)!.steps.map((step) => step.relationship),
    );
  }
  expect(result.path.path?.length).toBe(1);
  expect(result.path.incomplete).toBe(false);
  expect(
    result.second?.nodes.some((node) => result.first.nodes.some((before) => before.id === node.id)),
  ).toBe(false);
  return {
    scenarios: result.scenarios.length,
    sourceVerified: true,
    scopeVerified: true,
    pathVerified: true,
    cursorVerified: true,
    httpCandidateVerified: true,
  };
}
