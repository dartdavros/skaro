import { readGraphFile as readFile } from './read-file';
import { existsSync } from 'node:fs';
import type { C4Model } from '@skaro/core/c4-view';
import {
  graphScenarios,
  type GraphQuery,
  type GraphScope,
  type SourceRef,
} from '@skaro/core/graph-view';
import { GraphStore } from './store';
import { queryGraph } from './query';
import { exportGraphPage } from './export-page';
import { assertScope } from './query-validation';
import { hash } from './facts';
import { safeSource } from './source-policy';
import type { IndexJob } from './indexer';

type Request = {
  id: number;
  operation: string;
  args: {
    database: string;
    root: string;
    scope?: GraphScope;
    query?: GraphQuery;
    ref?: SourceRef;
    kind?: 'nodes' | 'edges';
    after?: string;
  } & Partial<IndexJob>;
};

const port = process.parentPort;
const lifetime = new AbortController();
let active = 0;

async function run({ id, operation, args }: Request) {
  if (operation === 'index') {
    const { buildIndex } = await import('./indexer');
    return buildIndex(
      args as IndexJob,
      (done, total, stage) => port.postMessage({ id, progress: { done, total, stage } }),
      lifetime.signal,
    );
  }
  if (operation === 'status' && !existsSync(args.database)) return null;
  const store = new GraphStore(args.database, operation !== 'prune');
  try {
    if (operation === 'prune') return await store.prune();
    store.db.exec('BEGIN');
    if (operation === 'status') return store.current() ?? null;
    if (operation === 'query') return queryGraph(store, args.query!);
    if (operation === 'export') return exportGraphPage(store, args.scope!, args.kind!, args.after);
    const snapshot = assertScope(store, args.scope!);
    if (operation === 'model' || operation === 'scenarios') {
      const model = store.meta<C4Model | null>(`model:${snapshot.id}`) ?? null;
      return operation === 'model' ? model : model ? graphScenarios(model, snapshot) : [];
    }
    if (operation === 'source') {
      const ref = args.ref!;
      if (
        !ref ||
        ref.checkoutId !== snapshot.checkoutId ||
        typeof ref.path !== 'string' ||
        typeof ref.contentHash !== 'string'
      )
        throw new Error('Invalid graph source');
      const path = await safeSource(args.root, ref.path),
        bytes = await readFile(path);
      if (bytes.length > 2 * 1024 * 1024) throw new Error('Graph source exceeds file size budget');
      if (hash(bytes) !== ref.contentHash) throw new Error('graph-source-stale');
      return { path: ref.path, text: bytes.toString('utf8'), line: Math.max(1, ref.line ?? 1) };
    }
    throw new Error('Unknown graph operation');
  } finally {
    if (operation !== 'prune') store.db.exec('ROLLBACK');
    store.close();
  }
}

port.on('message', ({ data }) => {
  const message = data as Request;
  if (message.operation === 'shutdown') {
    lifetime.abort(new Error('graph-cancelled'));
    if (!active) process.exit(0);
    return;
  }
  if (lifetime.signal.aborted) return;
  active++;
  void run(message)
    .then(
      (value) => {
        if (!lifetime.signal.aborted) port.postMessage({ id: message.id, value });
      },
      (error: unknown) => {
        if (!lifetime.signal.aborted)
          port.postMessage({
            id: message.id,
            error: error instanceof Error ? error.message : String(error),
          });
      },
    )
    .finally(() => {
      active--;
      if (!active && lifetime.signal.aborted) process.exit(0);
    });
});
