import {
  applyC4Package,
  c4PackageStatus,
  c4Hash,
  prepareRebasedC4Impact,
  type C4Package,
} from '@skaro/core';
import type { PayloadStore } from './payload-store';
import type { C4ProposalRecord } from '../c4-service';
import { c4RecordProtocol } from '../c4-record-protocol';

/** A separately saved application candidate never rewrites the immutable owner-reviewed package. */
export function c4ApplicationWork(
  store: PayloadStore,
  read: (project: string, id: string) => C4Package,
  record: (project: string, id: string) => C4ProposalRecord,
) {
  const db = store.db,
    queues = new Map<string, Promise<void>>();
  db.exec(
    'CREATE TABLE IF NOT EXISTS c4_applications (project TEXT NOT NULL,id TEXT NOT NULL,original_hash TEXT NOT NULL,protocol TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project,id))',
  );
  const application = (project: string, id: string, pkg: C4Package) => {
    const row = db
      .prepare('SELECT * FROM c4_applications WHERE project=? AND id=?')
      .get(project, id);
    if (!row) return undefined;
    if (row.original_hash !== c4Hash(JSON.stringify(pkg)) || row.protocol !== 'impact-v1')
      throw new Error('C4 application identity/protocol changed');
    return {
      payload: String(row.payload),
      pkg: JSON.parse(store.read(String(row.payload))) as C4Package,
    };
  };
  const status = async (root: string, project: string, id: string) => {
    const original = read(project, id),
      meta = record(project, id);
    if (c4RecordProtocol(meta) !== 'impact-v1') return c4PackageStatus(root, original);
    const saved = application(project, id, original);
    return saved ? c4PackageStatus(root, saved.pkg) : 'unwritten';
  };
  const apply = async (root: string, project: string, id: string) => {
    const original = read(project, id),
      meta = record(project, id);
    if (meta.item.state !== 'accepted' && meta.item.state !== 'applied')
      throw new Error('C4 application requires a confirmed original decision');
    if (c4RecordProtocol(meta) !== 'impact-v1') return applyC4Package(root, original);
    for (let attempt = 0; attempt < 2; attempt++) {
      const saved = application(project, id, original);
      if (saved) {
        const physical = await c4PackageStatus(root, saved.pkg);
        if (physical === 'applied') return;
        if (physical === 'writing') return applyC4Package(root, saved.pkg);
      }
      const candidate = await prepareRebasedC4Impact(root, original);
      const payload = store.text(JSON.stringify(candidate));
      if (saved) {
        if (
          db
            .prepare('UPDATE c4_applications SET payload=? WHERE project=? AND id=? AND payload=?')
            .run(payload, project, id, saved.payload).changes !== 1
        )
          throw new Error('C4 application CAS changed');
      } else
        db.prepare('INSERT INTO c4_applications VALUES (?,?,?,?,?)').run(
          project,
          id,
          c4Hash(JSON.stringify(original)),
          'impact-v1',
          payload,
        );
      try {
        await applyC4Package(root, candidate);
        return;
      } catch (error) {
        if ((await c4PackageStatus(root, candidate)) !== 'unwritten' || attempt === 1) throw error;
      }
    }
  };
  return {
    'c4.status': status,
    'c4.apply': (root: string, project: string, id: string) => {
      const next = (queues.get(project) ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => apply(root, project, id));
      queues.set(project, next);
      return next.finally(() => {
        if (queues.get(project) === next) queues.delete(project);
      });
    },
  };
}
