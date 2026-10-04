import { describe, expect, it } from 'vitest';
import { UpdateActivity } from './update-activity';

describe('explicit update application guard', () => {
  it('keeps an unverified installed bundle from launching agents while allowing recovery and normal reads', async () => {
    const activity = new UpdateActivity(() => false);
    activity.quarantine(true);
    for (const method of [
      'agents.login',
      'agents.models',
      'agents.install',
      'tasks.run',
      'task.respond',
      'task.merge',
      'chat.create',
      'chat.send',
      'chat.proposal',
      'import.start',
    ] as const) {
      await expect(activity.invoke(method, () => true)).rejects.toThrow('UPDATE_BUNDLE_UNVERIFIED');
    }
    await expect(activity.invoke('projects.list', () => true)).resolves.toBe(true);
    await expect(activity.invoke('app.checkUpdate', () => true)).resolves.toBe(true);
    activity.quarantine(false);
    await expect(activity.invoke('chat.send', () => true)).resolves.toBe(true);
  });
  it('blocks running tasks and pending user interaction, then permits an idle app', () => {
    let running = true;
    const activity = new UpdateActivity(() => running);
    expect(() => activity.enterApply()).toThrow('UPDATE_BUSY');
    running = false;
    activity.observe('chat.events', {
      projectId: 'project',
      chatId: 'chat',
      seq: 0,
      events: [{ t: 'status', state: 'waiting' }],
    });
    expect(() => activity.enterApply()).toThrow('UPDATE_BUSY');
    activity.observe('chat.events', {
      projectId: 'project',
      chatId: 'chat',
      seq: 1,
      events: [{ t: 'status', state: 'idle' }],
    });
    expect(() => activity.enterApply()).not.toThrow();
  });
  it('covers in-flight import writes and closes the race with new IPC work', async () => {
    const activity = new UpdateActivity(() => false);
    let finish!: () => void;
    const write = activity.invoke(
      'chat.proposal',
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    expect(() => activity.enterApply()).toThrow('UPDATE_BUSY');
    finish();
    await write;
    activity.enterApply();
    await expect(activity.invoke('chat.send', () => undefined)).rejects.toThrow('UPDATE_APPLYING');
    await expect(activity.invoke('updates.state', () => true)).resolves.toBe(true);
    activity.release();
    await expect(activity.invoke('chat.send', () => true)).resolves.toBe(true);
  });
  it('releases failed IPC work and never schedules an automatic restart', async () => {
    const activity = new UpdateActivity(() => false);
    await expect(
      activity.invoke('import.start', () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    expect(activity.busy()).toBe(false);
    activity.observe('task.events', {
      projectId: 'project',
      taskId: 'task',
      runId: 'run',
      seq: 0,
      events: [{ t: 'status', state: 'working' }],
    });
    expect(activity.busy()).toBe(true);
    activity.observe('task.events', {
      projectId: 'project',
      taskId: 'task',
      runId: 'run',
      seq: 1,
      events: [{ t: 'status', state: 'idle' }],
    });
    expect(activity.busy()).toBe(false);
  });
});
