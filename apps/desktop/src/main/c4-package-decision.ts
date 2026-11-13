import { dirname } from 'node:path';
import type { C4PackageReview } from '@skaro/core/c4-view';
import type { C4ProposalRecord, C4ServiceDeps } from './c4-service';
import { background } from './background/client';
import { c4RecordProtocol } from './c4-record-protocol';
import { requireC4PackageReview } from './c4-package-review';
import { recoverC4DecisionReply } from './c4-decision-recovery';
import { c4AcceptedCheckpoint } from './c4-accepted-checkpoint';

/** A physical failure cannot revoke an owner's already persisted consent. */
export const c4ApplicationFailureState = (physical: string | undefined) =>
  physical === 'applied' ? ('applied' as const) : ('accepted' as const);
export async function decideC4Package(
  deps: C4ServiceDeps,
  api: {
    records(project: string): Promise<C4ProposalRecord[]>;
    save(record: C4ProposalRecord): Promise<void>;
    review(project: string, id: string): Promise<C4PackageReview>;
  },
  projectId: string,
  id: string,
  action: 'apply' | 'reject',
  fingerprint?: string,
) {
  const record = (await api.records(projectId)).find((r) => r.item.id === id);
  if (!record) throw new Error('Unknown C4 package');
  const protocol = c4RecordProtocol(record);
  if (record.item.state === 'applied' && action === 'apply') return;
  if (!['pending', 'accepted'].includes(record.item.state))
    throw new Error('This C4 package is already decided');
  if (action === 'apply' && record.item.state === 'pending') {
    if (protocol === 'impact-v1')
      await requireC4PackageReview(deps.db, deps.projects.get(projectId), record);
    const review = await api.review(projectId, id);
    if (!fingerprint || fingerprint !== review.fingerprint)
      throw new Error('Open the current architecture package before accepting it.');
  }
  if (action === 'reject' && record.item.state === 'accepted')
    throw new Error(
      'A confirmed package must finish recovery; it cannot be rejected after writing starts.',
    );
  const context = deps.projects.get(projectId),
    dataDir = dirname(deps.db.filePath);
  if (action === 'reject') record.item = { ...record.item, state: 'rejected' };
  else {
    record.item = { ...record.item, state: 'accepted', result: {} };
    await api.save(record);
    try {
      await deps.publish(record.scope, record.item);
      await c4AcceptedCheckpoint(deps.db, projectId, id);
      await background(dataDir, 'c4.apply', context.root, projectId, id);
      if ((await background(dataDir, 'c4.status', context.root, projectId, id)) !== 'applied')
        throw new Error('C4 physical application has not been verified');
      record.item = { ...record.item, state: 'applied', result: {} };
    } catch (error) {
      const physical = await background(dataDir, 'c4.status', context.root, projectId, id).catch(
        () => undefined,
      );
      const state = c4ApplicationFailureState(physical);
      record.item = {
        ...record.item,
        state,
        result: state === 'applied' ? {} : { error: String(error) },
      };
      if (state !== 'applied') {
        await api.save(record);
        context.invalidate();
        deps.changed(projectId);
        await deps.publish(record.scope, record.item);
        throw error;
      }
    }
  }
  await api.save(record);
  context.invalidate();
  recoverC4DecisionReply(deps.db, record);
  deps.changed(projectId);
  if (record.item.state === 'applied')
    deps.db.addEvent(projectId, 'c4_application_verified', {
      packageId: id,
      scope: record.scope,
      protocol,
    });
  await deps.publish(record.scope, record.item);
}
