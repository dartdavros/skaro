import { randomUUID } from 'node:crypto';
import { AppDb } from '@skaro/core';
import { expect, it } from 'vitest';
import { ProjectCoordinators } from './project-coordinators';
import { coordinationHash, coordinationRequest } from './project-coordinator-request';
import { sessionCommand, sessionCommandScope } from './session-command-catalogue';

it('registers a conversation and runs an unrelated task mutation after an interrupted merge', async () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Observed Skaro', path: process.cwd() });
    const controller = new ProjectCoordinators(db);
    const merge = {
      id: randomUUID(),
      projectId: project.id,
      action: 'mcp.merge_task',
      source: { kind: 'worker' as const, id: 'observed-run' },
      subject: { kind: 'task' as const, id: 'T-020' },
      mode: 'mutation' as const,
      scopeKey: 'project',
      expectedVersion: 0,
      inputHash: coordinationHash('observed-input'),
    };
    const blocked = db.coordination.accept(coordinationRequest(merge));
    db.coordination.claim(project.id, blocked.id, {
      expectedRevision: blocked.revision,
      claimId: randomUUID(),
    });
    db.coordination.recover(project.id);
    const id = 'chat-create:' + randomUUID();
    const command = sessionCommand(
      'chat.create',
      [project.id, {}, { text: 'Inspect the unresolved task' }],
      id,
    )!;
    expect(command.mode).toBe('control');
    const request = {
      id,
      projectId: project.id,
      action: 'ipc.chat.create',
      source: { kind: 'owner' as const, id: 'renderer' },
      subject: command.subject,
      mode: command.mode,
      scopeKey: sessionCommandScope(command, id),
      inputHash: coordinationHash('actual-conversation-registration'),
    };
    db.coordination.accept(
      coordinationRequest({
        ...request,
        mode: 'mutation',
        scopeKey: 'project',
        expectedVersion: 1,
      }),
    );
    controller.recover();
    expect(db.coordination.getOperation(project.id, id)).toMatchObject({
      state: 'queued',
      mode: 'control',
    });
    let registrations = 0;
    const create = () => {
      registrations++;
      return db.createChat({
        projectId: project.id,
        agent: 'codex',
        title: 'Coordination diagnosis',
        logPath: 'README.md',
      });
    };
    const created = await controller.execute(request, create);
    const repeated = await controller.execute(request, create, {
      replay: () => db.getChat(created.id)!,
    });
    expect(repeated.id).toBe(created.id);
    expect(registrations).toBe(1);
    expect(db.coordination.get(project.id)?.version).toBe(1);
    await expect(
      controller.execute(merge, () => {
        throw new Error('An interrupted merge must not be dispatched again');
      }),
    ).rejects.toHaveProperty('operation.state', 'uncertain');
    const submission = {
      ...merge,
      id: randomUUID(),
      action: 'mcp.submit_result',
      subject: { kind: 'task' as const, id: 'T-024' },
      expectedVersion: 1,
    };
    await expect(controller.execute(submission, () => 'accepted')).resolves.toBe('accepted');
    expect(db.coordination.getOperation(project.id, submission.id)?.state).toBe('succeeded');
    expect(db.coordination.getOperation(project.id, blocked.id)?.state).toBe('uncertain');
  } finally {
    db.close();
  }
});

it('moves only an unclaimed legacy chat registration to its control lane without losing command identity', () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Observed Skaro', path: process.cwd() });
    const id = 'chat-create:' + randomUUID();
    const request = {
      id,
      projectId: project.id,
      action: 'ipc.chat.create',
      source: { kind: 'owner' as const, id: 'renderer' },
      subject: { kind: 'command' as const, id },
      mode: 'mutation' as const,
      scopeKey: 'project',
      expectedVersion: 0,
      inputHash: coordinationHash({ command: id }),
    };
    const queued = db.coordination.accept(coordinationRequest(request));
    const migrated = db.coordination.migrateConversation(project.id, id, queued.revision);
    expect(migrated).toMatchObject({
      id,
      state: 'queued',
      mode: 'control',
      inputHash: queued.inputHash,
      eventId: queued.eventId,
      intentId: queued.intentId,
      scopeKey: `control:command:${id}`,
    });
    expect(migrated.expectedVersion).toBeUndefined();
    const { expectedVersion: _version, ...rest } = request;
    expect(
      db.coordination.accept(
        coordinationRequest({ ...rest, mode: 'control', scopeKey: migrated.scopeKey }),
      ).id,
    ).toBe(id);
    db.coordination.claim(project.id, id, {
      expectedRevision: migrated.revision,
      claimId: randomUUID(),
    });
    expect(() =>
      db.coordination.migrateConversation(project.id, id, migrated.revision + 1),
    ).toThrow();
  } finally {
    db.close();
  }
});
