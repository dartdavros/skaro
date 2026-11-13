import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { migrateCoordinatorProject } from './coordinator-migration';
import { requireCoordinationDispatch } from './coordination-dispatch';
import { coordinationHash, coordinationRequest } from './project-coordinator-request';

// Actual SQLite with protocol metadata pointing to existing repository folders; no runtime/project fixture.
it('onboards every legacy chat/run without changing authors, histories, native permissions or stopped intent', () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Observed repository', path: process.cwd() });
    const chat = db.createChat({
      projectId: project.id,
      agent: 'codex',
      title: 'Observed',
      logPath: 'README.md',
    });
    db.createChat({
      projectId: project.id,
      taskId: 'observed-task',
      agent: 'codex',
      title: 'Task conversation metadata',
      logPath: 'package.json',
    });
    const run = db.createRun({
      projectId: project.id,
      taskId: 'observed-task',
      agent: 'codex',
      logPath: 'package.json',
      adapterVersion: 'observed',
    });
    const stopped = db.createRun({
      projectId: project.id,
      taskId: 'stopped-owner',
      agent: 'codex',
      logPath: 'README.md',
      adapterVersion: 'observed',
    });
    db.setSetting(`chat.${chat.id}.agent`, { permissionMode: 'full' });
    db.setSetting(`execution.${stopped.id}`, {
      enabled: false,
      stalls: 0,
      blocked: 'Owner stopped',
    });
    db.commands.accept({
      id: 'legacy-unlinked',
      owner: `${project.id}:observed-task`,
      method: 'task.send',
      args: [project.id, 'observed-task', { text: 'Historical command metadata' }],
      state: 'accepted',
    });
    const chats = db.listChats(project.id, { includeTasks: true });
    const operation = db.coordination.accept(
      coordinationRequest({
        id: 'legacy-observation',
        projectId: project.id,
        action: 'legacy.observed',
        source: { kind: 'controller', id: 'legacy-observation' },
        subject: { kind: 'task', id: run.taskId },
        scopeKey: 'legacy-observation',
        mode: 'observation',
        inputHash: coordinationHash('observed'),
      }),
    );
    const blocker = db.coordination.blockers.create({
      id: 'legacy-blocker',
      projectId: project.id,
      eventId: operation.eventId,
      category: 'environment',
      subject: operation.subject,
      inputHash: coordinationHash('observed'),
      resolution: { code: 'unknown-legacy-condition', refs: [operation.subject] },
      subscribers: [operation.subject],
    });
    const first = migrateCoordinatorProject(db, project.id);
    expect(first).toMatchObject({
      version: 1,
      blocked: false,
      chats: 2,
      runs: 2,
      legacyIntentsStopped: 1,
      ambiguousCommands: 1,
      policy: 'confirm-default',
      legacyBlockers: 1,
    });
    expect(db.listChats(project.id, { includeTasks: true })).toEqual(chats);
    expect(db.coordination.blockers.get(project.id, blocker.id)).toEqual(blocker);
    expect(db.getSetting(`chat.${chat.id}.agent`, undefined)).toEqual({ permissionMode: 'full' });
    expect(db.getSetting(`execution.${run.id}`, undefined)).toEqual({ enabled: false, stalls: 0 });
    expect(db.getSetting(`execution.${stopped.id}`, undefined)).toMatchObject({
      enabled: false,
      blocked: 'Owner stopped',
    });
    expect(db.commands.get('legacy-unlinked')).toMatchObject({
      state: 'uncertain',
      args: [project.id, 'observed-task', { text: 'Historical command metadata' }],
    });
    expect(migrateCoordinatorProject(db, project.id)).toEqual(first);
    expect(db.getSetting(`coordination.policy.${project.id}`, undefined)).toMatchObject({
      mode: 'confirm',
      rules: [],
      denied: [],
    });
  } finally {
    db.close();
  }
});
it('quarantines unknown rights instead of interpreting them as approval and refuses a foreign scope', () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Observed repository', path: process.cwd() });
    const separate = db.addProject({
      name: 'Separate scope',
      path: process.cwd() + '/packages/core',
    });
    const raw = { mode: 'full', revision: 0 };
    db.setSetting(`coordination.policy.${project.id}`, raw);
    expect(migrateCoordinatorProject(db, project.id).blocked).toBe(true);
    expect(db.getSetting(`coordination.policy.${project.id}`, undefined)).toEqual(raw);
    expect(() => requireCoordinationDispatch(db, project.id)).toThrow('suspended');
    db.shell.scopeTo(project.id);
    expect(() => migrateCoordinatorProject(db, separate.id)).toThrow('scope invalid');
    expect(db.getSetting(`coordination.migration.v1.${separate.id}`, undefined)).toBeUndefined();
  } finally {
    db.close();
  }
});
