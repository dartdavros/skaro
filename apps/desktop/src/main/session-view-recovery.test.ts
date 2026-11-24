import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AppDb } from '@skaro/core';
import { expect, it } from 'vitest';
import { ProjectCoordinators } from './project-coordinators';
import {
  coordinationHash,
  coordinationRequest,
  type ProjectOperationRequest,
} from './project-coordinator-request';
import { beginTransition, pendingTransitions, transitionPhase } from './task-lifecycle-journal';

it.each(['task', 'chat'] as const)(
  'reopens a %s after a lost view and a later handler failure',
  async (kind) => {
    const db = AppDb.open(':memory:');
    try {
      const project = db.addProject({ name: 'Skaro', path: process.cwd() });
      const request = (): ProjectOperationRequest => ({
        id: randomUUID(),
        projectId: project.id,
        action: `ipc.${kind}.open`,
        mode: 'observation',
        source: { kind: 'owner', id: 'renderer' },
        subject: { kind, id: 'subject' },
        scopeKey: `observation:${kind}:subject`,
        inputHash: coordinationHash([project.id, 'subject']),
      });
      const lost = db.coordination.accept(coordinationRequest(request()));
      db.coordination.claim(project.id, lost.id, {
        expectedRevision: lost.revision,
        claimId: randomUUID(),
      });
      const queued = db.coordination.accept(coordinationRequest(request()));
      const controller = new ProjectCoordinators(db);
      controller.recover();
      expect(db.coordination.getOperation(project.id, lost.id)?.evidence?.code).toBe(
        'session_view_not_returned',
      );
      expect(db.coordination.getOperation(project.id, queued.id)?.state).toBe('rejected');
      // Genuine filesystem failure. A subsequent observation must still reach its handler.
      await expect(
        controller.execute(request(), () => readFile(import.meta.filename + '/package.json')),
      ).rejects.toThrow();
      await expect(
        controller.execute(request(), () => readFile(import.meta.filename, 'utf8')),
      ).resolves.toContain('session_view_not_returned');
      expect(db.coordination.pending(project.id)).toEqual([]);
    } finally {
      db.close();
    }
  },
);

it('preserves a newer owner stop when a delayed resume is acknowledged', () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Skaro', path: process.cwd() });
    const resume = beginTransition(db, project.id, {
      id: 'task',
      from: 'paused',
      target: 'in_progress',
      run: 'run',
    });
    const stop = beginTransition(db, project.id, {
      id: 'task',
      from: 'paused',
      target: 'stopped',
      run: 'run',
    });
    expect(transitionPhase(db, project.id, resume, 'confirmed')).toBe(false);
    expect(pendingTransitions(db, project.id)).toEqual([stop]);
    expect(transitionPhase(db, project.id, stop, 'confirmed')).toBe(true);
    expect(pendingTransitions(db, project.id)[0]?.phase).toBe('confirmed');
    expect(transitionPhase(db, project.id, stop, 'settled')).toBe(true);
    expect(pendingTransitions(db, project.id)).toEqual([]);
  } finally {
    db.close();
  }
});
