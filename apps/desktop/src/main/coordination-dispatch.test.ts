import { expect, it } from 'vitest';
import { AppDb, type OwnerCommand } from '@skaro/core';
import { ProjectCoordinators } from './project-coordinators';
import { dispatchState, setCoordinationDispatch } from './coordination-dispatch';
import { registerOwnerOrigin, requireOwnerOrigin } from './owner-command-provenance';
import { ApplicationResources } from './application-resources';
import { resourceExecution } from './resource-execution';
import { modelDispatchScope } from './model-dispatch-scope';
import { decisionIsSafety } from './decision-authority';
import { coordinationHash } from './project-coordinator-request';

it('fences accepted deliveries and waiting model admission across off/on, preserving data and stop/reads', async () => {
  const db = AppDb.open(':memory:');
  const project = db.addProject({ name: 'Observed repository', path: process.cwd() });
  const controllers = new ProjectCoordinators(db);
  const resources = new ApplicationResources(db, process.cwd());
  try {
    controllers.recover();
    const command: OwnerCommand = {
      id: 'observed-owner-command',
      owner: `${project.id}:observed`,
      method: 'task.send',
      args: [project.id, 'observed', { text: 'Observed protocol input' }],
      state: 'accepted',
    };
    registerOwnerOrigin(db, command);
    db.commands.accept(command);
    await resources.scope(project.id, 'protocol-observation', async () => {
      const guarded = modelDispatchScope(db, 'model', resourceExecution.getStore())!;
      const off = setCoordinationDispatch(db, project.id, false, 0);
      expect(db.commands.get(command.id)).toMatchObject({ state: 'uncertain', args: command.args });
      expect(() => modelDispatchScope(db, 'model', resourceExecution.getStore())).toThrow(
        'suspended',
      );
      setCoordinationDispatch(db, project.id, true, off.revision);
      expect(() => modelDispatchScope(db, 'model', resourceExecution.getStore())).toThrow(
        'suspended',
      );
      await expect(guarded.requireCurrent()).rejects.toThrow('suspended');
      expect(() => requireOwnerOrigin(db, command)).toThrow('suspended');
    });
    expect(resources.holdings(project.id, 'protocol-observation')).toEqual([]);
    expect(dispatchState(db, project.id)).toEqual({ enabled: true, revision: 2 });
    expect(() => setCoordinationDispatch(db, project.id, false, 0)).toThrow('changed');
    setCoordinationDispatch(db, project.id, false, 2);
    const request = {
      id: 'observed-stop',
      projectId: project.id,
      action: 'ipc.task.interrupt',
      source: { kind: 'owner' as const, id: 'observed' },
      subject: { kind: 'task' as const, id: 'observed' },
      inputHash: coordinationHash('metadata'),
      mode: 'control' as const,
      scopeKey: 'stop:observed',
    };
    await expect(
      controllers.execute(request, async () => db.coordination.ensure(project.id).id),
    ).resolves.toBe(`coordinator:${project.id}`);
    expect(() =>
      controllers.execute(
        { ...request, id: 'new-work', action: 'owner.task.send', mode: 'delivery' },
        async () => undefined,
      ),
    ).toThrow('suspended');
    expect(
      decisionIsSafety({ kind: 'respond', answer: { kind: 'approval', choice: 'deny' } }),
    ).toBe(true);
    expect(
      decisionIsSafety({ kind: 'respond', answer: { kind: 'approval', choice: 'allow_once' } }),
    ).toBe(false);
  } finally {
    await controllers.close();
    await resources.close();
    db.close();
  }
});
