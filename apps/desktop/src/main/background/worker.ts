import { parentPort, workerData, threadId } from 'node:worker_threads';
import { configureC4Locks, ArtifactStore, authoredBody, readC4DocumentSnapshot } from '@skaro/core';
import { c4Work } from './c4-work';
import { PayloadStore } from './payload-store';
import type { BackgroundMethods } from './protocol';
import { artifactWork } from './artifact-work';
import { historyWork } from './history-work';
import { canonicalWork } from './canonical-work';
import { ArtifactIndex } from './artifact-index';
import { historyReadWork } from './history-read-work';
import { requirementsOf } from '../../shared/task-requirements';
import { HistoryTransfers } from './history-transfer';
import { ArtifactCatalog } from './artifact-catalog';
import { documentCatalog } from './document-catalog';
import { ProjectIndex } from './project-index';
import { overviewWork } from './overview-work';
import { taskListWork, stageListWork } from './task-list-work';
import { milestoneWork } from './milestone-work';
import { saveSessionCache } from './session-cache';
import { taskCatalogWork } from './task-catalog-work';
import { ChatCatalogReader } from './chat-catalog';

let c4: ReturnType<typeof c4Work> | undefined;
let store: PayloadStore | undefined;
let reads: ReturnType<typeof historyReadWork> | undefined;
const transfers = new HistoryTransfers();
let chatCatalog: ChatCatalogReader | undefined;
let registry: ProjectIndex | undefined;
let documents: ReturnType<typeof documentCatalog> | undefined;
let taskCatalog: ReturnType<typeof taskCatalogWork> | undefined;
configureC4Locks((workerData as { locks: SharedArrayBuffer }).locks, threadId + 1);
parentPort!.on(
  'message',
  (request: { id: number; method: keyof BackgroundMethods; args: unknown[] }) => {
    if (String(request.method) === 'worker.close') {
      chatCatalog?.close();
      store?.db.close();
      parentPort!.close();
      return;
    }
    void (async () => {
      if (request.method.startsWith('chats.')) {
        chatCatalog ??= new ChatCatalogReader((workerData as { dataDir: string }).dataDir);
        const args = request.args;
        if (request.method === 'chats.query')
          return chatCatalog.query(args[0] as string, args[1] as boolean);
        if (request.method === 'chats.page')
          return chatCatalog.page(
            args[0] as import('../../shared/chat-catalog').ChatRange,
            args[1] as number,
          );
        return chatCatalog.find(
          args[0] as import('../../shared/chat-catalog').ChatRange,
          args[1] as string,
        );
      }
      store ??= new PayloadStore(
        (workerData as { dataDir: string }).dataDir,
        request.method.startsWith('registry.')
          ? 'registry.db'
          : request.method.startsWith('tasks.')
            ? 'tasks.db'
            : 'workspace.db',
      );
      if (request.method === 'artifacts.milestones')
        return milestoneWork(store, request.args[0] as string);
      if (request.method.startsWith('tasks.catalog.')) {
        taskCatalog ??= taskCatalogWork(store);
        const action = taskCatalog[request.method as keyof typeof taskCatalog] as (
          ...args: unknown[]
        ) => unknown;
        return action(...request.args);
      }
      if (request.method === 'tasks.stages')
        return stageListWork(store, ...(request.args as [string, string]));
      if (request.method === 'tasks.list')
        return taskListWork(store, ...(request.args as [string, string, string?]));
      if (request.method === 'overview.card') return overviewWork(store, request.args[0] as string);
      if (request.method === 'registry.session')
        return saveSessionCache(
          store,
          ...(request.args as Parameters<BackgroundMethods['registry.session']>),
        );
      if (request.method === 'registry.migrate') {
        registry ??= new ProjectIndex(store);
        return;
      }
      if (request.method.startsWith('registry.')) {
        registry ??= new ProjectIndex(store);
        const args = request.args;
        if (request.method === 'registry.query')
          return registry.query(args[0] as import('../../shared/project-catalog').ProjectQuery);
        if (request.method === 'registry.page')
          return registry.page(
            args[0] as import('../../shared/project-catalog').ProjectRange,
            args[1] as number,
          );
        if (request.method === 'registry.card')
          return registry.update(args[0] as import('../../shared/ipc-sessions').ProjectCard);
        return registry.refresh();
      }
      if (request.method.startsWith('catalog.')) {
        documents ??= documentCatalog(new ArtifactCatalog(store));
        const action = documents[request.method as keyof typeof documents] as (
          ...args: unknown[]
        ) => unknown;
        return action(...request.args);
      }
      if (request.method.startsWith('read.')) {
        reads ??= historyReadWork(store);
        const action = reads[request.method as keyof typeof reads] as (
          ...args: unknown[]
        ) => unknown;
        return action(...request.args);
      }
      if (request.method === 'artifacts.setDocumentStatus') {
        const [root, kind, id, status] = request.args as [
          string,
          'adr' | 'spec',
          string,
          import('@skaro/core').AdrStatus,
        ];
        await new ArtifactStore(root).setDocumentStatus(kind, id, status);
        documents?.['catalog.invalidate'](root);
        return;
      }
      if (request.method === 'artifacts.writeDocumentBody') {
        const [root, path, body] = request.args as [string, string, string];
        await new ArtifactStore(root).writeDocumentBody(path, body);
        documents?.['catalog.invalidate'](root, [path]);
        return;
      }
      if (request.method === 'artifacts.read') {
        const [root, path] = request.args as [string, string];
        return authoredBody((await new ArtifactIndex(store, root).read(path)).body);
      }
      if (request.method === 'artifacts.document') {
        const [root, path] = request.args as [string, string];
        return readC4DocumentSnapshot(root, path);
      }
      if (request.method === 'artifacts.requirements') {
        const [root, path] = request.args as [string, string];
        return new ArtifactIndex(store, root).project(path, 'requirements:v1', (parsed) =>
          requirementsOf(parsed.body),
        );
      }
      if (request.method === 'artifacts.load') {
        const action = artifactWork(store) as (...args: unknown[]) => unknown;
        return action(...request.args);
      }
      if (request.method === 'history.next') return transfers.next(request.args[0] as string);
      if (request.method === 'history.close') return transfers.close(request.args[0] as string);
      if (request.method === 'history.restore' || request.method === 'history.open') {
        const action = historyWork(store) as (...args: unknown[]) => unknown;
        const result = await action(...request.args);
        return request.method === 'history.open'
          ? transfers.open(result as import('./history-transfer').HistorySnapshot)
          : result;
      }
      if (request.method === 'history.canonical')
        return canonicalWork(...(request.args as [string, string]));
      c4 ??= c4Work(store);
      const action = c4[request.method as keyof typeof c4] as (...args: unknown[]) => unknown;
      if (!action) throw new Error(`Unknown background method ${request.method}`);
      return action(...request.args);
    })().then(
      (value) => parentPort!.postMessage({ id: request.id, value }),
      (error: unknown) =>
        parentPort!.postMessage({
          id: request.id,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  },
);
