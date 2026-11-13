import type { AppDb, C4Protocol } from '@skaro/core';
import type { C4ProposalRecord } from './c4-service';
import type {
  ArchiagentActivation,
  ArchiagentActivationExpected,
} from '../shared/archiagent-activation';
import { activationFeatures, activationKey, parseActivation } from './archiagent-activation-state';
import { activationSnapshot } from './archiagent-activation-snapshot';
import { coordinationHash } from './project-coordinator-request';
import { mapC4Operations } from './c4-audit-migration';

/** One SQLite commit selects the future-run protocol and opens dispatch. Old run bindings stay pinned. */
export function activateArchiagent(
  db: AppDb,
  project: string,
  protocol: C4Protocol,
  expected: ArchiagentActivationExpected,
  requestId: string,
  records: C4ProposalRecord[],
) {
  if (
    !['package-v1', 'impact-v1'].includes(protocol) ||
    typeof requestId !== 'string' ||
    !requestId.trim()
  )
    throw new Error('Activation requires an explicit supported protocol and owner request');
  const requestHash = coordinationHash([project, protocol, expected]);
  db.settings.atomic(() => {
    const current = activationSnapshot(db, project, records);
    const key = activationKey(project),
      prior = parseActivation(db.getSetting(key, undefined, { strict: true }));
    if (prior?.requestId === requestId) {
      if (prior.requestHash !== requestHash) throw new Error('Activation request identity changed');
      if (
        !current.dispatch.enabled ||
        current.dispatch.revision !== prior.dispatchRevision ||
        !current.compatible
      )
        throw new Error('Activation was suspended; a fresh owner request is required');
      return;
    }
    if (
      current.dispatch.enabled ||
      current.dispatch.revision !== expected.dispatchRevision ||
      (prior?.revision ?? 0) !== expected.activationRevision ||
      current.protocol !== expected.protocol ||
      current.eligibility !== expected.eligibility ||
      !current.compatible
    )
      throw new Error(
        'Activation inputs changed or dispatch is not suspended; inspect current state',
      );
    mapC4Operations(db, project, records);
    const nextDispatch = { enabled: true, revision: current.dispatch.revision + 1 };
    const next: ArchiagentActivation = {
      version: 1,
      revision: (prior?.revision ?? 0) + 1,
      coordinatorId: db.coordination.get(project)!.id,
      protocol,
      schemaVersion: db.schemaVersion,
      features: activationFeatures,
      requestId,
      requestHash,
      eligibility: expected.eligibility,
      dispatchRevision: nextDispatch.revision,
    };
    const protocolKey = `c4.coordination.protocol.${project}`,
      dispatchKey = `coordination.dispatch.${project}`;
    const storedProtocol = db.getSetting(protocolKey, undefined, { strict: true });
    const storedDispatch = db.getSetting(dispatchKey, undefined, { strict: true });
    if (
      !db.settings.compareAndSet(protocolKey, storedProtocol, protocol) ||
      !db.settings.compareAndSet(dispatchKey, storedDispatch, nextDispatch) ||
      !db.settings.compareAndSet(key, prior, next)
    )
      throw new Error('Activation changed concurrently');
    db.addEvent(project, 'archiagent_activated', {
      activation: next,
      previousProtocol: current.protocol,
      oldRuns: 'unchanged',
    });
    db.addEvent(project, 'coordinator_dispatch_changed', nextDispatch);
  });
  return activationSnapshot(db, project, records);
}
