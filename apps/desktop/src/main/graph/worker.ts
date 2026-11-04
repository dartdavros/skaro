import { parentPort } from 'node:worker_threads';
import { readGraphFile as readFile } from './read-file';
import { existsSync } from 'node:fs';
import { readC4Model, validateC4Model } from '@skaro/core/c4-view';
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

parentPort!.on(
  'message',
  (message: {
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
  }) => {
    void (async () => {
      const { operation, args } = message;
      if (operation === 'index') {
        const { buildIndex } = await import('./indexer');
        return buildIndex(args as IndexJob, (done, total, stage) =>
          parentPort!.postMessage({ id: message.id, progress: { done, total, stage } }),
        );
      }
      if (operation === 'model') {
        if (args.scope) {
          const store = new GraphStore(args.database, true);
          try {
            store.db.exec('BEGIN');
            const snapshot = assertScope(store, args.scope);
            return (
              store.meta<import('@skaro/core/c4-view').C4Model | null>(`model:${snapshot.id}`) ??
              null
            );
          } finally {
            store.db.exec('ROLLBACK');
            store.close();
          }
        }
        let source: string;
        try {
          source = await readFile(await safeSource(args.root, '.skaro/c4/model.json'), 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
        const model = readC4Model(JSON.parse(source)),
          errors = validateC4Model(model);
        if (errors.length) throw new Error(errors.join('; '));
        return model;
      }
      if (operation === 'status' && !existsSync(args.database)) return null;
      const store = new GraphStore(args.database, operation !== 'prune');
      try {
        if (operation === 'prune') return await store.prune();
        store.db.exec('BEGIN');
        if (operation === 'status') return store.current() ?? null;
        if (operation === 'query') return queryGraph(store, args.query!);
        if (operation === 'export')
          return exportGraphPage(store, args.scope!, args.kind!, args.after);
        const snapshot = assertScope(store, args.scope!);
        if (operation === 'scenarios') {
          const model = store.meta<import('@skaro/core/c4-view').C4Model | null>(
            `model:${snapshot.id}`,
          );
          return model ? graphScenarios(model, snapshot) : [];
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
          if (bytes.length > 2 * 1024 * 1024)
            throw new Error('Graph source exceeds file size budget');
          if (hash(bytes) !== ref.contentHash) throw new Error('graph-source-stale');
          return { path: ref.path, text: bytes.toString('utf8'), line: Math.max(1, ref.line ?? 1) };
        }
        throw new Error('Unknown graph operation');
      } finally {
        if (operation !== 'prune') store.db.exec('ROLLBACK');
        store.close();
      }
    })().then(
      (value) => parentPort!.postMessage({ id: message.id, value }),
      (error: unknown) => {
        console.error('Graph worker operation failed:', error);
        parentPort!.postMessage({
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  },
);
