import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { TaskStartup } from './task-startup';
import { TaskExecution } from './task-execution';
import { requireStartupGeneration } from './task-startup-generation';
import { setCoordinationDispatch } from './coordination-dispatch';
import { requireIntegrationDispatch, renewIntegrationDispatch } from './integration-dispatch-fence';

it('retains queued input while fencing legacy and old generations, and requires fresh owner intent after off/on', () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Observed repository', path: process.cwd() });
    const run = db.createRun({
      projectId: project.id,
      taskId: 'observed',
      agent: 'codex',
      adapterVersion: 'observed',
      logPath: 'package.json',
    });
    const execution = new TaskExecution(db, run.id);
    execution.start();
    execution.followUp('owner-request', 'Continue the bounded observation');
    execution.resume('owner-request', 'Continue the bounded observation');
    const startup = new TaskStartup(db),
      input = { commandId: 'owner-request', text: 'Continue the bounded observation' };
    db.collections.put(`integration.${project.id}.operations`, {
      id: 'observed-candidate',
      state: 'resolving',
    });
    startup.begin(project.id, run.taskId, [input], 0);
    requireStartupGeneration(
      db,
      project.id,
      startup.read(project.id, run.taskId)?.dispatchRevision,
    );
    const off = setCoordinationDispatch(db, project.id, false, 0);
    setCoordinationDispatch(db, project.id, true, off.revision);
    expect(() => requireIntegrationDispatch(db, project.id, 'observed-candidate')).toThrow(
      'suspended',
    );
    renewIntegrationDispatch(db, project.id, 'observed-candidate');
    requireIntegrationDispatch(db, project.id, 'observed-candidate');
    expect(execution.read().enabled).toBe(false);
    expect(execution.resume('owner-request', input.text)).toBe(false);
    expect(startup.read(project.id, run.taskId)?.inputs).toEqual([input]);
    expect(() =>
      requireStartupGeneration(
        db,
        project.id,
        startup.read(project.id, run.taskId)?.dispatchRevision,
      ),
    ).toThrow('suspended');
    expect(() =>
      startup.begin(
        project.id,
        run.taskId,
        [{ commandId: 'new', text: 'New bounded instruction' }],
        2,
      ),
    ).toThrow('earlier dispatch');
    startup.cancel(project.id, run.taskId);
    startup.begin(
      project.id,
      run.taskId,
      [{ commandId: 'fresh', text: 'New bounded instruction' }],
      2,
    );
    requireStartupGeneration(
      db,
      project.id,
      startup.read(project.id, run.taskId)?.dispatchRevision,
    );
    startup.begin(project.id, 'legacy', [input]);
    expect(() =>
      requireStartupGeneration(
        db,
        project.id,
        startup.read(project.id, 'legacy')?.dispatchRevision,
      ),
    ).toThrow('no verified');
  } finally {
    db.close();
  }
});
