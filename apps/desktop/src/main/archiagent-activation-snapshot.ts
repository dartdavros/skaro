import { c4RunProtocol, parseRemedyPolicy, type AppDb, type C4ProtocolBinding } from '@skaro/core';
import type { CoordinatorMigration } from '../shared/coordination-control';
import type { C4ProposalRecord } from './c4-service';
import type { ArchiagentStatus } from '../shared/archiagent-activation';
import {
  activationKey,
  parseActivation,
  activationBlocksDispatch,
} from './archiagent-activation-state';
import { dispatchState, migrationBlocksDispatch } from './coordination-dispatch';
import { coordinationHash } from './project-coordinator-request';
import { projectC4Protocol } from './c4-protocol';
import { c4RecordProtocol } from './c4-record-protocol';

/** Mutable receipts/lease states are observations, not authority to rewrite old operations. */
export function activationSnapshot(
  db: AppDb,
  project: string,
  records: C4ProposalRecord[],
): ArchiagentStatus {
  const dispatch = dispatchState(db, project),
    coordinator = db.coordination.get(project);
  if (!coordinator) throw new Error('Project coordinator has not completed onboarding');
  const activation = parseActivation(
    db.getSetting(activationKey(project), undefined, { strict: true }),
  );
  const protocol = projectC4Protocol(db, project);
  const bindings = db
    .listRuns(project, undefined, { includeRetired: true })
    .map((run) => {
      const binding = db.getSetting<C4ProtocolBinding | undefined>(
        `c4.coordination.run.${run.id}`,
        undefined,
        { strict: true },
      );
      return {
        id: run.id,
        binding: binding ?? null,
        protocol: c4RunProtocol(project, run.id, binding),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  // Parse actual persisted resource formats; unknown holdings are never replaced with a free budget.
  db.resources.list(project);
  db.admission.all();
  const packages = records
    .map((record) => {
      if (record.scope.projectId !== project)
        throw new Error('C4 package is outside activation scope');
      return {
        id: record.item.id,
        scope: record.scope,
        protocol: c4RecordProtocol(record),
        identity: coordinationHash({ package: record.package, files: record.fileIndex }),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const migration = db.getSetting<CoordinatorMigration | undefined>(
    `coordination.migration.v1.${project}`,
    undefined,
    { strict: true },
  );
  const policy = db.getSetting<{ revision: number } | undefined>(
    `coordination.policy.${project}`,
    undefined,
    { strict: true },
  );
  if (!policy)
    throw new Error('Coordinator owner policy is missing; complete onboarding before activation');
  parseRemedyPolicy(policy, policy.revision);
  const compatible =
    migration?.version === 1 &&
    migration.controllerId === coordinator.id &&
    !migrationBlocksDispatch(db, project) &&
    !activationBlocksDispatch(db, project);
  return {
    dispatch,
    activation,
    protocol,
    compatible,
    ...(!compatible
      ? { reason: 'Project migration or activation requires review; new dispatch is blocked' }
      : {}),
    eligibility: coordinationHash({
      schema: db.schemaVersion,
      coordinator: coordinator.id,
      migration,
      protocol,
      policy,
      resources: db.getSetting('resources.policy.v1', {}, { strict: true }),
      costs: db.getSetting('resources.costs.v1', {}, { strict: true }),
      bindings,
      packages,
    }),
    pinnedRuns: {
      legacy: bindings.filter((r) => r.protocol === 'package-v1').length,
      impact: bindings.filter((r) => r.protocol === 'impact-v1').length,
    },
    packages: {
      pending: records.filter((r) => r.item.state === 'pending').length,
      accepted: records.filter((r) => r.item.state === 'accepted').length,
      terminal: records.filter((r) => !['pending', 'accepted'].includes(r.item.state)).length,
    },
  };
}
