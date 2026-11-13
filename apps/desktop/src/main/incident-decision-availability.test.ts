import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppDb, incidentHash } from '@skaro/core';
import { ProjectCoordinators } from './project-coordinators';
import { IncidentStore } from './incident-store';
import {
  incidentDecisionAvailability,
  retiredIncidentDecision,
} from './incident-decision-availability';

// Actual SQLite decision records over a repository observation; no substitute service or agent.
it('accepts a pending owner question without remedy permission, but fences approvals and terminal incidents', async () => {
  const db = AppDb.open(':memory:');
  const project = db.addProject({ name: 'Observed repository', path: process.cwd() });
  const coordinators = new ProjectCoordinators(db);
  const store = new IncidentStore(db, coordinators);
  const file = resolve('package.json');
  const version = incidentHash(readFileSync(file, 'utf8'));
  try {
    coordinators.recover();
    let incident = await store.report(
      project.id,
      { kind: 'document', id: file, version },
      {
        cause: 'dependency',
        code: 'input_observed',
        condition: 'owner-evidence',
        phase: 'waiting',
        resourceVersion: version,
        attempts: 0,
        subscriptions: [],
      },
      { taskId: file, runId: version, inputs: version, intent: 1 },
      'Repository input observation',
      'controller',
    );
    const create = (id: string, kind: 'question' | 'approval') => {
      const decision = db.coordination.decisions.create({
        id,
        projectId: project.id,
        eventId: incident.eventId,
        kind,
        subject: { kind: 'blocker', id: incident.id },
        inputHash: version,
      });
      incident = store.update(incident, { decisionId: id });
      return decision;
    };
    const question = create('owner-question', 'question');
    expect(retiredIncidentDecision(db, project.id, question.id)).toBeUndefined();
    expect(incidentDecisionAvailability(db, project.id, question.id, 0)).toEqual({});
    expect(incidentDecisionAvailability(db, project.id, question.id, 1)).toEqual({});
    db.coordination.decisions.transition(project.id, question.id, {
      expectedRevision: question.revision,
      state: 'answered',
      evidence: { code: 'owner_answer_recorded', refs: [incident.subject] },
    });
    expect(incidentDecisionAvailability(db, project.id, question.id, 0)).toBeUndefined();
    expect(retiredIncidentDecision(db, project.id, question.id)).toBe('answered');

    const approval = create('remedy-approval', 'approval');
    const key = `coordination.decision-action.${approval.id}`;
    expect(incidentDecisionAvailability(db, project.id, approval.id, 0)).toBeUndefined();
    const expiresAt = Date.now() + 60_000;
    db.setSetting(key, { policyRevision: 0, expiresAt });
    expect(incidentDecisionAvailability(db, project.id, approval.id, 0)).toEqual({ expiresAt });
    expect(incidentDecisionAvailability(db, project.id, approval.id, 1)).toBeUndefined();
    db.setSetting(key, { policyRevision: 0, expiresAt: 0 });
    expect(incidentDecisionAvailability(db, project.id, approval.id, 0)).toBeUndefined();
    const next = create('next-question', 'question');
    db.setSetting(key, { policyRevision: 0, expiresAt });
    expect(incidentDecisionAvailability(db, project.id, approval.id, 0)).toBeUndefined();
    expect(retiredIncidentDecision(db, project.id, approval.id)).toBe('cancelled');
    expect(retiredIncidentDecision(db, project.id, next.id)).toBeUndefined();
    store.resolve(incident, version);
    expect(retiredIncidentDecision(db, project.id, approval.id)).toBe('cancelled');
    expect(retiredIncidentDecision(db, project.id, next.id)).toBe('cancelled');
    expect(incidentDecisionAvailability(db, project.id, next.id, 0)).toBeUndefined();
  } finally {
    await coordinators.close();
    db.close();
  }
});
