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
  it('rechecks actual executing work instead of retaining a previous busy status', () => {
    let running = true;
    const activity = new UpdateActivity(() => running);
    expect(() => activity.enterApply()).toThrow('UPDATE_BUSY');
    running = false;
    expect(() => activity.enterApply()).not.toThrow();
    activity.release();
    running = true;
    expect(() => activity.enterApply()).toThrow('UPDATE_BUSY');
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
    expect(() => activity.enterApply()).not.toThrow();
  });
  it('permits application while UI observations are pending but fences subsequent IPC', async () => {
    const activity = new UpdateActivity(() => false);
    let finish!: () => void;
    const read = new Promise<void>((resolve) => (finish = resolve));
    const observations = [
      'background.state',
      'history.page',
      'task.open',
      'chat.open',
      'tasks.query',
      'tasks.slots',
      'agents.list',
      'projects.overview',
      'incidents.list',
    ] as const;
    const pending = observations.map((method) => activity.invoke(method, () => read));
    expect(activity.busy()).toBe(false);
    activity.enterApply();
    await expect(activity.invoke('history.page', () => true)).rejects.toThrow('UPDATE_APPLYING');
    finish();
    await Promise.all(pending);
    activity.release();
    expect(activity.busy()).toBe(false);
  });
});
