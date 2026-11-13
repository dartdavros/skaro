import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { blockOwnerMessages, OwnerCommands } from './owner-commands';
import { ProjectCoordinators } from './project-coordinators';

it('rejects new messages while clearing and releases the owner lock after failure', () => {
  const db = AppDb.open(':memory:');
  const commands = new OwnerCommands(db, () => {
    throw new Error('No command may be accepted');
  });
  const unblock = blockOwnerMessages('project', 'chat');
  try {
    expect(() => commands.accept('chat.send', 'project', 'chat', { text: 'continue' })).toThrow(
      'being cleared',
    );
    expect(() => blockOwnerMessages('project', 'chat')).toThrow('being cleared');
    expect(db.commands.pending()).toEqual([]);
  } finally {
    unblock();
    db.close();
  }
  const next = blockOwnerMessages('project', 'chat');
  next();
});
it('admits and cancels protocol metadata during recovery without dispatching a native handler', async () => {
  const db = AppDb.open(':memory:');
  const project = db.addProject({ name: 'Recovery metadata', path: process.cwd() });
  const coordinators = new ProjectCoordinators(db);
  coordinators.recover();
  let delivered = false;
  const commands = new OwnerCommands(db, () => undefined, coordinators, process.cwd());
  const forbidden = async () => {
    delivered = true;
    throw new Error('No native executor belongs in this metadata-only test');
  };
  try {
    commands.start({ 'chat.send': forbidden, 'task.send': forbidden }, true);
    commands.accept('chat.send', project.id, 'original-owner', {
      text: 'Original metadata input',
      commandId: 'original-command',
    });
    await Promise.resolve();
    expect(db.commands.get('original-command')?.state).toBe('accepted');
    expect(delivered).toBe(false);
    commands.cancel(`${project.id}:original-owner`);
    commands.activate();
    await commands.close();
    expect(delivered).toBe(false);
    expect(db.commands.get('original-command')?.state).toBe('cancelled');
  } finally {
    await commands.close();
    db.close();
  }
});
