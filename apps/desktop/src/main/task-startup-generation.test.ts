import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { TaskStartup } from './task-startup';
import { TaskExecution } from './task-execution';
import { requireStartupGeneration, requireTaskStartup } from './task-startup-generation';
import { setCoordinationDispatch } from './coordination-dispatch';
import { requireIntegrationDispatch } from './integration-dispatch-fence';

it('keeps task execution, queued input and integration independent of project chat dispatch; Stop invalidates the task epoch', () => {
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
    const queued = startup.read(project.id, run.taskId)!;
    const off = setCoordinationDispatch(db, project.id, false, 0);
    requireTaskStartup(db, startup, project.id, run.taskId);
    requireIntegrationDispatch(db, project.id, 'observed-candidate');
    expect(execution.read().enabled).toBe(true);
    expect(startup.read(project.id, run.taskId)?.inputs).toEqual([input]);
    setCoordinationDispatch(db, project.id, true, off.revision);
    startup.delivered(project.id, run.taskId);
    requireTaskStartup(db, startup, project.id, run.taskId, queued);
    startup.cancel(project.id, run.taskId);
    expect(() => requireTaskStartup(db, startup, project.id, run.taskId, queued)).toThrow(
      'cancelled',
    );
    expect(startup.cancellationEpoch(project.id, run.taskId)).toBe(queued.taskEpoch! + 1);
    expect(startup.read(project.id, run.taskId)).toBeUndefined();
    startup.begin(project.id, run.taskId, [{ commandId: 'fresh', text: input.text }]);
    requireTaskStartup(db, startup, project.id, run.taskId);
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
