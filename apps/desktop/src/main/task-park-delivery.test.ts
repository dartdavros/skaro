import { randomUUID } from 'node:crypto';
import { AppDb, incidentHash } from '@skaro/core';
import { expect, it } from 'vitest';
import { coordinationHash, coordinationRequest } from './project-coordinator-request';
import { beginTransition, linkTransitionIncident, transitionPhase } from './task-lifecycle-journal';
import { IncidentStore } from './incident-store';
import { ProjectCoordinators } from './project-coordinators';
import { parkCommandId, parkDelivery, reconcileParkDelivery } from './task-park-delivery';
import { taskStopDeliveries } from './task-stop-deliveries';
import { registerOwnerOrigin } from './owner-command-provenance';

it('retires only task-directed inputs when the task shares its feed with an integration', () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Skaro', path: process.cwd() }).id;
    const accept = (id: string, task: string, internal: boolean) =>
      db.commands.accept({
        id,
        owner: `${project}:${task}`,
        method: 'task.send',
        state: 'accepted',
        args: [project, task, { text: '', commandId: id, internal }],
      }).id;
    const owned = accept('continue-incident-original', 'T-010', true);
    const resolver = accept('owner-message', 'T-010', false);
    const other = accept('diagnose-incident-other', 'T-011', true);
    const resume = (id: string) => ({
      id,
      owner: `${project}:T-010`,
      method: 'task.send',
      state: 'accepted' as const,
      args: [project, 'T-010', { text: '', commandId: id, resumeTask: true }],
    });
    const fresh = resume(randomUUID());
    registerOwnerOrigin(db, fresh);
    db.commands.accept(fresh);
    const legacy = db.commands.accept(resume(randomUUID()));
    registerOwnerOrigin(db, legacy);
    expect(taskStopDeliveries(db, project, 'T-010', [fresh.id, legacy.id], true)).toEqual([
      fresh.id,
    ]);
    expect(taskStopDeliveries(db, project, 'T-010', [owned, resolver, other], true)).toEqual([
      owned,
    ]);
  } finally {
    db.close();
  }
});

it('recovers only the exact acknowledged Stop after the file transition has settled', () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Skaro', path: process.cwd() });
    const subject = { kind: 'task', id: 'task' } as const;
    const commandId = randomUUID();
    const id = parkCommandId(commandId);
    const operation = db.coordination.accept(
      coordinationRequest({
        id,
        projectId: project.id,
        action: 'ipc.task.park',
        source: { kind: 'owner', id: 'renderer' },
        subject,
        mode: 'control',
        scopeKey: `stop:${id}`,
        inputHash: coordinationHash([project.id, subject.id, 'stopped', commandId]),
      }),
    );
    db.coordination.claim(project.id, id, {
      expectedRevision: operation.revision,
      claimId: randomUUID(),
    });
    const entry = beginTransition(db, project.id, {
      id: subject.id,
      from: 'in_progress',
      target: 'stopped',
      run: 'run',
      commandId,
    });
    const [lost] = db.coordination.recover(project.id);
    transitionPhase(db, project.id, entry, 'confirmed');
    expect(reconcileParkDelivery(db, lost!)).toBe(false);
    transitionPhase(db, project.id, entry, 'settled');
    expect(reconcileParkDelivery(db, lost!)).toBe(true);
    expect(parkDelivery(db, project.id, id, subject).replay()).toEqual({
      requestId: commandId,
      status: 'stopped',
      revision: 3,
    });
  } finally {
    db.close();
  }
});

it('keeps an unconfirmed resume visible to the project until the owner supersedes it', async () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Skaro', path: process.cwd() }).id;
    const store = new IncidentStore(db, new ProjectCoordinators(db));
    const entry = beginTransition(db, project, {
      id: 'task',
      from: 'stopped',
      target: 'in_progress',
      run: 'run',
      commandId: randomUUID(),
    });
    const incident = await store.report(
      project,
      { kind: 'task', id: entry.id },
      {
        cause: 'external',
        code: 'task_lifecycle_unconfirmed',
        condition: 'owner-evidence',
        phase: 'waiting',
        resourceVersion: entry.token,
        attempts: 0,
        subscriptions: [],
      },
      { taskId: entry.id, runId: 'run', intent: 0, inputs: incidentHash(entry.token) },
      'No durable acknowledgement',
      'controller',
    );
    linkTransitionIncident(db, project, entry, incident.id);
    expect(store.list(project).find((row) => row.id === incident.id)?.state).toBe('open');
    beginTransition(db, project, {
      id: entry.id,
      from: 'stopped',
      target: 'stopped',
      run: entry.run,
    });
    expect(store.get(project, incident.id)).toMatchObject({
      state: 'cancelled',
      evidence: { code: 'owner_transition_superseded' },
    });
    expect(transitionPhase(db, project, entry, 'confirmed')).toBe(false);
  } finally {
    db.close();
  }
});
