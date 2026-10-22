import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  prepareC4Package,
  applyC4Package,
  c4PackageStatus,
  c4PackageText,
  prepareC4DocumentMigration,
  type C4Package,
} from '@skaro/core';
import { c4ReviewWork } from './c4-review-work';
import { architecturePresentation } from '@skaro/timeline';
import type { C4ProposalRecord } from '../c4-service';
import type { BackgroundMethods } from './protocol';
import { PayloadStore } from './payload-store';
import { c4Context } from '../c4-context';
import { artifactWork } from './artifact-work';

type StoredPackage = Omit<C4Package, 'files'> & {
  files: { path: string; before: string | null; after: string }[];
};
export function c4Work(store: PayloadStore) {
  const db = store.db;
  function save(record: C4ProposalRecord): void {
    const { package: pkg, item, scope } = record;
    if (!pkg.files.length && item.proposal.type === 'architecture' && item.proposal.contentRef) {
      db.prepare('UPDATE records SET state=?, metadata=? WHERE project=? AND id=?').run(
        item.state,
        JSON.stringify(record),
        scope.projectId,
        item.id,
      );
      return;
    }
    const proposal = item.proposal;
    if (proposal.type !== 'architecture') throw new Error('Expected an architecture proposal');
    store.transaction(() => {
      const files = pkg.files.map((file) => ({
        path: file.path,
        before: file.before === null ? null : store.text(file.before),
        after: store.text(file.after),
      }));
      const compact: C4ProposalRecord = {
        scope,
        package: { ...pkg, files: [] },
        fileIndex: files.map((f) => ({ path: f.path, beforeHash: f.before, afterHash: f.after })),
        item: {
          ...item,
          proposal: architecturePresentation(proposal, item.id),
        },
      };
      const payload = JSON.stringify({ ...pkg, files });
      const existing = db.prepare('SELECT payload FROM records WHERE id=?').get(item.id);
      if (existing && existing['payload'] !== payload)
        throw new Error('An architecture package is immutable; prepare a new proposal.');
      db.prepare(
        `INSERT INTO records VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET state=excluded.state, metadata=excluded.metadata, payload=excluded.payload`,
      ).run(
        scope.projectId,
        item.id,
        scope.taskId ?? scope.chatId ?? '',
        item.state,
        JSON.stringify(compact),
        payload,
      );
    });
  }
  function migrate(projectId: string): void {
    const key = `c4.proposals.${projectId}`;
    if (db.prepare('SELECT 1 FROM migrations WHERE key=?').get(key)) return;
    // Read the legacy database only in this worker. Source stays intact until verified migration.
    const legacy = new DatabaseSync(join(store.dataDir, 'skaro.db'), { readOnly: true });
    let records: C4ProposalRecord[];
    try {
      const row = legacy.prepare('SELECT value FROM settings WHERE key=?').get(key);
      records = row ? (JSON.parse(String(row['value'])) as C4ProposalRecord[]) : [];
    } finally {
      legacy.close();
    }
    for (const record of records) {
      if (!db.prepare('SELECT 1 FROM records WHERE id=?').get(record.item.id)) save(record);
    }
    db.prepare('INSERT OR IGNORE INTO migrations VALUES (?)').run(key);
  }
  function list(projectId: string, ownerId?: string): C4ProposalRecord[] {
    migrate(projectId);
    const rows =
      ownerId === undefined
        ? db.prepare('SELECT metadata FROM records WHERE project=?').all(projectId)
        : db
            .prepare('SELECT metadata FROM records WHERE project=? AND owner=?')
            .all(projectId, ownerId);
    return rows.map((r) => {
      const record = JSON.parse(String(r['metadata'])) as C4ProposalRecord;
      if (record.item.proposal.type === 'architecture')
        record.item.proposal = architecturePresentation(record.item.proposal, record.item.id);
      return record;
    });
  }
  function pkg(projectId: string, itemId: string, paths?: string[]): C4Package {
    migrate(projectId);
    const row = db
      .prepare('SELECT payload FROM records WHERE project=? AND id=?')
      .get(projectId, itemId);
    if (!row) throw new Error('Unknown C4 package');
    const saved = JSON.parse(String(row['payload'])) as StoredPackage;
    return {
      ...saved,
      files: saved.files
        .filter((f) => !paths || paths.includes(f.path))
        .map((f) => ({
          path: f.path,
          before: f.before === null ? null : store.read(f.before),
          after: store.read(f.after),
        })),
    };
  }
  function recordPackage(prepared: C4Package, scope: C4ProposalRecord['scope']): C4ProposalRecord {
    const item: C4ProposalRecord['item'] = {
      id: `skaro-c4-${randomUUID()}`,
      turnId: '',
      kind: 'proposal',
      state: 'pending',
      status: 'done',
      startedAt: Date.now(),
      native: { agent: 'skaro', type: 'proposal', ref: 'architecture' },
      proposal: {
        type: 'architecture',
        packageId: prepared.id,
        title: prepared.title,
        summary: prepared.summary,
        baseRevision: prepared.baseRevision,
        task: prepared.task,
      },
    };
    save({ scope, package: prepared, item });
    return list(scope.projectId, scope.taskId ?? scope.chatId).find((r) => r.item.id === item.id)!;
  }
  return {
    ...c4ReviewWork(pkg),
    'c4.prepareMigration': async (root, locale, scope) => {
      migrate(scope.projectId);
      // Guard again in the storage lane; preparing a migration cannot invalidate a pending package.
      if (list(scope.projectId).some((r) => ['pending', 'accepted'].includes(r.item.state)))
        throw new Error('Resolve pending architecture packages before document migration.');
      const prepared = await prepareC4DocumentMigration(root, locale);
      return prepared && recordPackage(prepared, scope);
    },
    'c4.files': (project, id) => {
      migrate(project);
      const row = db
        .prepare('SELECT payload FROM records WHERE project=? AND id=?')
        .get(project, id);
      if (!row) throw new Error('Unknown C4 package');
      return (JSON.parse(String(row['payload'])) as StoredPackage).files.map((file) => file.path);
    },
    'c4.file': (project, id, path, side) => {
      migrate(project);
      const row = db
        .prepare('SELECT payload FROM records WHERE project=? AND id=?')
        .get(project, id);
      if (!row) throw new Error('Unknown C4 package');
      const saved = JSON.parse(String(row['payload'])) as StoredPackage;
      const file = saved.files.find((value) => value.path === path);
      if (!file) throw new Error('Unknown C4 package file');
      const hash = file[side];
      const text = hash === null ? null : store.read(hash);
      return c4PackageText(
        {
          ...saved,
          files: [
            {
              path,
              before: side === 'before' ? text : null,
              after: side === 'after' ? (text ?? '') : '',
            },
          ],
        },
        side,
      );
    },
    'c4.context': async (root, defaults, scope, checkout) => {
      const legacy = new DatabaseSync(join(store.dataDir, 'skaro.db'), { readOnly: true });
      try {
        const { value: artifacts } = await artifactWork(store)(root, defaults, 0);
        return await c4Context(
          { root, load: async () => artifacts, invalidate: () => undefined },
          {
            getSetting: <T>(key: string, fallback?: T): T => {
              const row = legacy.prepare('SELECT value FROM settings WHERE key=?').get(key);
              return row ? (JSON.parse(String(row['value'])) as T) : (fallback as T);
            },
          },
          list(scope.projectId),
          scope,
          checkout,
          async (id) => pkg(scope.projectId, id),
        );
      } finally {
        legacy.close();
      }
    },
    'c4.list': list,
    'c4.package': pkg,
    'c4.save': save,
    'c4.content': (project, id, side) => c4PackageText(pkg(project, id), side),
    'c4.apply': async (root, project, id) => applyC4Package(root, pkg(project, id)),
    'c4.status': async (root, project, id) => c4PackageStatus(root, pkg(project, id)),
    'c4.prepare': async (root, args, scope) => {
      migrate(scope.projectId);
      const prepared = await prepareC4Package(root, {
        ...args,
        ...(scope.kind === 'task' ? { task: { id: scope.taskId!, runId: scope.runId! } } : {}),
      });
      return recordPackage(prepared, scope);
    },
  } satisfies Pick<BackgroundMethods, Extract<keyof BackgroundMethods, `c4.${string}`>>;
}
