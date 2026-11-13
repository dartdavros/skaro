import { c4Hash, type AppDb } from '@skaro/core';
import type { C4Service, C4ProposalRecord } from './c4-service';
import { c4RecordProtocol } from './c4-record-protocol';
import { recoverC4DecisionReply } from './c4-decision-recovery';

/** Add a route alongside legacy records. Package bytes, decisions and protocol bindings stay intact. */
export function mapC4Operations(db: AppDb, project: string, records: C4ProposalRecord[]) {
  return records.map((record) => {
    const key = `c4.operation-route.${project}.${record.item.id}`;
    const identity = {
      packageId: record.item.id,
      projectId: project,
      scope: record.scope,
      protocol: c4RecordProtocol(record),
      fingerprint: c4Hash(JSON.stringify({ package: record.package, files: record.fileIndex })),
    };
    const prior = db.getSetting<typeof identity | undefined>(key, undefined, { strict: true });
    if (prior && JSON.stringify(prior) !== JSON.stringify(identity))
      throw new Error('Saved C4 operation identity changed');
    if (!prior && !db.settings.compareAndSet(key, undefined, identity))
      throw new Error('C4 operation migration changed');
    const links = {
      packageId: record.item.id,
      decisionId: record.item.id,
      source: record.scope,
      dependentResults: record.package.task
        ? [
            {
              taskId: record.package.task.id,
              runId: record.package.task.runId,
              gate: 'original-task-c4-review',
            },
          ]
        : [],
      pendingRoute: 'original-owner-decision',
      acceptedRoute: 'original-journaled-application',
    };
    const linksKey = `c4.operation-links.${project}.${record.item.id}`;
    const savedLinks = db.getSetting<typeof links | undefined>(linksKey, undefined, {
      strict: true,
    });
    if (savedLinks && JSON.stringify(savedLinks) !== JSON.stringify(links))
      throw new Error('C4 dependent operation mapping changed');
    if (!savedLinks && !db.settings.compareAndSet(linksKey, undefined, links))
      throw new Error('C4 operation mapping changed');
    return { ...identity, links, state: record.item.state, error: record.item.result?.error };
  });
}
export async function recoverC4Operations(db: AppDb, c4: C4Service, project: string) {
  const records = await c4.records(project);
  mapC4Operations(db, project, records);
  for (const record of records) {
    if (record.item.state !== 'accepted') continue;
    try {
      await c4.decide(project, record.item.id, 'apply');
    } catch (error) {
      db.addEvent(project, 'c4_recovery_conflict', {
        packageId: record.item.id,
        error: String(error),
      });
    }
  }
  for (const record of await c4.records(project)) recoverC4DecisionReply(db, record);
}
