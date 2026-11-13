import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { COMPOSE_PROJECT, labelsOf, incidentHash } from '@skaro/core';
import type { Services } from '../app-services';
import { systemDocker } from '../task-environment-docker';
import { TaskExecution } from '../task-execution';

/** Reconcile only this driver's saved failed case, after observing its stopped partial results. */
export async function reconcileAdmissionPrior(
  s: Services,
  project: string,
  prior: string,
  proof: Record<string, unknown>,
) {
  const directory = resolve(prior);
  assert(
    /^environment-admission-[\da-f-]+$/.test(
      relative(resolve(s.dataDir, 'verification'), directory),
    ),
  );
  const saved = JSON.parse(await readFile(join(directory, 'proof.json'), 'utf8'));
  assert.equal(saved.project, project);
  assert(saved.error && saved.wait?.incident && saved.stopDuringWait);
  const row = s.runs.incidents.store.get(project, saved.wait.incident);
  assert.equal(row.protocol!.code, 'environment_waiting_resource');
  assert(
    row.protocol!.subscriptions.every(
      (sub) => sub.taskId === 'T-010' && !new TaskExecution(s.db, sub.runId).read().enabled,
    ),
  );
  const resource = s.db.resources.get(row.subject.id)!;
  assert(
    resource.projectId === project &&
      resource.ownership === 'registered' &&
      resource.owner.id === 'T-010',
  );
  const containers = (await systemDocker.inspect()).filter(
    (c) => labelsOf(c)[COMPOSE_PROJECT] === resource.identity.composeProject,
  );
  assert(containers.length && containers.every((c) => !c.State?.Running));
  assert(!s.resources.holdings(project, 'environment:T-010').length);
  assert(!s.resources.holdings(project, 'task:T-010').length);
  const operation =
    row.protocol!.operationId && s.db.coordination.getOperation(project, row.protocol!.operationId);
  if (operation && operation.state === 'uncertain') {
    const record = s.db
      .getSetting<import('../task-environment-registry').EnvironmentRecord[]>('environments', [])
      .find((e) => e.projectId === project && e.taskId === 'T-010');
    assert(
      record?.lastStart?.error &&
        record.lastStart.at >= operation.createdAt &&
        record.lastStart.at <= operation.updatedAt,
    );
    s.coordinators.reconcile(
      project,
      operation.id,
      {
        code: 'verification_failed_start_observed',
        refs: [row.subject],
        fingerprint: incidentHash(containers.map((c) => [c.Id, c.State])),
      },
      'failed',
    );
  }
  await s.runs.incidents.decisions.cancel(project, row.id);
  proof.previousFailedCase = {
    directory,
    incident: row.id,
    stoppedObjects: containers.map((c) => c.Id),
    replayed: false,
  };
}
