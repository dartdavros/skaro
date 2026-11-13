import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { ProjectCoordinators } from './project-coordinators';
import { OwnerCommands } from './owner-commands';
import { coordinationHash } from './project-coordinator-request';

// SQLite ownership/receipt metadata only. No native process, backend or runtime stop is fabricated.
it('requires current verified native teardown before releasing an unknown writer and admits a fresh request only afterward', async () => {
  const db = AppDb.open(':memory:');
  const project = db.addProject({ name: 'Native Stop metadata', path: process.cwd() }).id;
  const coordinators = new ProjectCoordinators(db);
  coordinators.recover();
  const commands = new OwnerCommands(db, () => undefined, coordinators, process.cwd());
  const run = db.createRun({
    projectId: project,
    taskId: 'bounded-owner',
    agent: 'codex',
    logPath: 'README.md',
    adapterVersion: 'metadata',
  });
  const command = {
    id: 'interrupted-metadata',
    owner: `${project}:bounded-owner`,
    method: 'task.send' as const,
    args: [project, 'bounded-owner', { text: 'Metadata only' }],
    state: 'accepted' as const,
  };
  db.commands.accept(command);
  await expect(
    coordinators.execute(
      {
        id: `owner-command:${command.id}`,
        projectId: project,
        action: 'owner.task.send',
        source: { kind: 'owner', id: command.id },
        subject: { kind: 'task', id: 'bounded-owner' },
        inputHash: coordinationHash(command.args),
        mode: 'delivery',
        scopeKey: 'delivery:task:bounded-owner',
      },
      () => {
        throw new Error('metadata unknown-result transition');
      },
    ),
  ).rejects.toThrow();
  db.commands.update(command.id, 'uncertain');
  const ids = commands.captureStop(project, 'bounded-owner'),
    proof = { kind: 'run' as const, id: run.id, version: 2 };
  expect(ids).toContain(command.id);
  expect(db.commands.get(command.id)?.state).toBe('uncertain');
  await expect(commands.confirmStopped(project, 'bounded-owner', ids, proof)).rejects.toThrow(
    'not been verified',
  );
  const key = `native.task-stop.${run.id}`;
  db.setSetting(key, {
    version: 1,
    state: 'verified',
    epoch: 1,
    requestId: 'metadata-stop',
    runs: [run.id],
  });
  await expect(commands.confirmStopped(project, 'bounded-owner', ids, proof)).rejects.toThrow();
  db.setSetting(key, {
    version: 1,
    state: 'verified',
    epoch: 2,
    requestId: 'metadata-stop',
    runs: [run.id],
  });
  db.setSetting(`run.${run.id}.processes`, [{ pid: 1, birth: 'metadata' }]);
  await expect(commands.confirmStopped(project, 'bounded-owner', ids, proof)).rejects.toThrow();
  db.setSetting(`run.${run.id}.processes`, []);
  await commands.confirmStopped(project, 'bounded-owner', ids, proof);
  expect(db.commands.get(command.id)?.state).toBe('cancelled');
  expect(db.coordination.getOperation(project, `owner-command:${command.id}`)?.state).toBe(
    'failed',
  );
  let starts = 0;
  await coordinators.execute(
    {
      id: 'fresh-metadata',
      projectId: project,
      action: 'metadata.read',
      source: { kind: 'owner', id: 'fresh' },
      subject: { kind: 'task', id: 'bounded-owner' },
      inputHash: coordinationHash('new read-only request'),
      mode: 'delivery',
      scopeKey: 'delivery:task:bounded-owner',
    },
    () => {
      starts++;
    },
  );
  expect(starts).toBe(1);
  await commands.close();
  await coordinators.close();
  db.close();
});
