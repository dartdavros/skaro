import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { Timeline } from '@skaro/timeline';
import { ActiveRun } from './task-run-model';
import { LiveChat } from './chat-model';
import { updateSessionBusy } from './update-session-activity';

it('does not turn restored running/waiting metadata into executing work, but tracks pending effects', async () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Runtime metadata', path: process.cwd() });
    const record = db.createRun({
      projectId: project.id,
      taskId: 'observed',
      agent: 'codex',
      adapterVersion: 'observed',
      logPath: 'package.json',
    });
    const timeline = Timeline.from([{ t: 'status', state: 'working' }]);
    const run = new ActiveRun(project.id, record.taskId, record, timeline);
    db.setTaskRuntime(project.id, record.taskId, 'running', record.id);
    expect(updateSessionBusy(run)).toBe(false);
    timeline.apply({ t: 'status', state: 'waiting' });
    db.setTaskRuntime(project.id, record.taskId, 'waiting', record.id);
    expect(updateSessionBusy(run)).toBe(false);
    let finish!: () => void;
    const effect = new Promise<void>((resolve) => (finish = resolve));
    run.operations.add(effect);
    expect(updateSessionBusy(run)).toBe(true);
    finish();
    await effect;
    run.operations.delete(effect);
    expect(updateSessionBusy(run)).toBe(false);
    const chat = db.createChat({
      projectId: project.id,
      title: 'Runtime metadata',
      agent: 'codex',
      logPath: 'package.json',
    });
    const live = new LiveChat(project.id, chat, timeline);
    expect(updateSessionBusy(live)).toBe(false);
    live.planningPending = effect;
    expect(updateSessionBusy(live)).toBe(true);
    live.planningPending = undefined;
    expect(updateSessionBusy(live)).toBe(false);
  } finally {
    db.close();
  }
});
