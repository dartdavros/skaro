import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { ProjectCoordinators } from './project-coordinators';
import { OwnerCommands, blockOwnerMessages } from './owner-commands';
import { TaskExecution } from './task-execution';
import { commitIncidentDelivery } from './incident-delivery';

it('rolls back blocker removal when the real inbox refuses and commits exactly one continuation otherwise', async () => {
  const db = AppDb.open(':memory:');
  const project = db.addProject({ name: 'Observed repository', path: process.cwd() });
  const coordinators = new ProjectCoordinators(db);
  const commands = new OwnerCommands(db, () => undefined, coordinators, process.cwd());
  try {
    coordinators.recover();
    const run = db.createRun({
      projectId: project.id,
      taskId: 'observed-task',
      agent: 'codex',
      adapterVersion: 'observed',
      logPath: 'package.json',
    });
    const execution = new TaskExecution(db, run.id);
    execution.start();
    execution.block('Observed unavailable condition', 'observed-incident');
    const subscription = {
      taskId: run.taskId,
      runId: run.id,
      intent: execution.intentVersion(),
      inputs: 'observed-version',
    };
    const enqueue = commands.accept.bind(commands);
    const blocked = blockOwnerMessages(project.id, run.taskId);
    expect(() =>
      commitIncidentDelivery(
        db,
        project.id,
        'observed-incident',
        'observed-resource',
        subscription,
        enqueue,
      ),
    ).toThrow('being cleared');
    blocked();
    expect(execution.read().blockedIncident).toBe('observed-incident');
    expect(db.commands.pending()).toEqual([]);
    commitIncidentDelivery(
      db,
      project.id,
      'observed-incident',
      'observed-resource',
      subscription,
      enqueue,
    );
    commitIncidentDelivery(
      db,
      project.id,
      'observed-incident',
      'observed-resource',
      subscription,
      enqueue,
    );
    expect(execution.read().blockedIncident).toBeUndefined();
    expect(db.commands.pending()).toHaveLength(1);
    expect(db.listEvents(project.id).filter((e) => e.kind === 'task_unblocked')).toHaveLength(1);
    execution.stop();
    execution.block('Owner stopped', 'another-incident');
    commitIncidentDelivery(
      db,
      project.id,
      'another-incident',
      'observed-resource',
      subscription,
      enqueue,
    );
    expect(db.commands.pending()).toHaveLength(1);
  } finally {
    await commands.close();
    await coordinators.close();
    db.close();
  }
});
