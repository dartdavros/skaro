import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppDb, incidentHash, remedyKey, type RemedyAction } from '@skaro/core';
import { ProjectCoordinators } from './project-coordinators';
import { IncidentStore } from './incident-store';
import { IncidentPolicy } from './incident-policy';
import { projectDecisionProjection } from './decision-projection';
import { emptyTimeline } from '@skaro/timeline';
import type { PreparedIncidentApproval } from './incident-answer-validation';

/** Real repository observation and SQLite protocol metadata; no substitute environment or agent. */
export async function observeIncidentApproval() {
  const db = AppDb.open(':memory:');
  const project = db.addProject({ name: 'Repository observation', path: process.cwd() });
  const coordinators = new ProjectCoordinators(db);
  coordinators.recover();
  const store = new IncidentStore(db, coordinators);
  const file = resolve('package.json');
  const version = incidentHash(readFileSync(file, 'utf8'));
  const taskId = 'repository-observation';
  let row = await store.report(
    project.id,
    { kind: 'document', id: file, version },
    {
      cause: 'dependency',
      code: 'observed-input',
      condition: 'inputs-current',
      phase: 'waiting',
      resourceVersion: version,
      attempts: 0,
      subscriptions: [],
    },
    { taskId, runId: version, inputs: version, intent: 1 },
    'Actual repository input observation',
    'controller',
  );
  const action: RemedyAction = {
    projectId: project.id,
    incidentId: row.id,
    kind: 'inputs.recheck',
    target: file,
    version,
    costUsd: 0,
  };
  const decision = db.coordination.decisions.create({
    id: incidentHash([row.id, remedyKey(action)]),
    projectId: project.id,
    eventId: row.eventId,
    kind: 'approval',
    subject: { kind: 'blocker', id: row.id },
    inputHash: remedyKey(action),
  });
  row = store.update(row, { decisionId: decision.id });
  const request = { action, policyRevision: 0, expiresAt: Date.now() + 60_000 };
  db.setSetting(`coordination.decision-action.${decision.id}`, request);
  const policy = new IncidentPolicy(db, coordinators);
  const entry = projectDecisionProjection([
    {
      projectId: project.id,
      kind: 'task',
      id: taskId,
      title: 'Observation',
      epoch: version,
      timeline: {
        ...emptyTimeline(),
        interactions: [
          {
            id: `coordinator:${decision.id}`,
            kind: 'approval',
            delivery: 'async',
            choices: ['allow_once', 'deny'],
            action: { type: 'other', title: 'check_prerequisites' },
          },
        ],
      },
    },
  ])[0]!;
  const prepared: PreparedIncidentApproval = { kind: 'approval', decision, row, request, action };
  return {
    db,
    project,
    taskId,
    coordinators,
    store,
    policy,
    prepared,
    entry,
    async close() {
      await coordinators.close();
      db.close();
    },
  };
}
