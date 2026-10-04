import { Timeline } from '@skaro/timeline';
import { describe, expect, it, vi } from 'vitest';
import { TaskRunEngine } from './task-run-engine';
import { key } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import { db, projectId, projects, taskRunDeps } from './task-run-test-support';

async function startedTask(engine: TaskRunEngine, title: string): Promise<ActiveRun> {
  const context = projects.get(projectId);
  const task = await context.store.createTask({ title, body: 'No criteria.\n' });
  await context.store.updateTask(task.id, { status: 'in_progress' });
  context.invalidate();
  const run = db.createRun({
    projectId,
    taskId: task.id,
    agent: 'codex',
    logPath: `runs/${task.id}.jsonl`,
    adapterVersion: 'test',
  });
  const active = new ActiveRun(projectId, task.id, run, new Timeline());
  engine.active.set(key(projectId, task.id), active);
  return active;
}

describe('slot per agent turn', () => {
  it('holds a later message of a started task in the queue until a slot is free', async () => {
    const engine = new TaskRunEngine(taskRunDeps(), 1);
    // No agent process: the message reaches the point where it would be handed to one.
    const delivered: string[] = [];
    engine.messages.deliver = vi.fn(async (active, input) => {
      delivered.push(`${active.taskId}: ${input.text}`);
    });
    const first = await startedTask(engine, 'First');
    const second = await startedTask(engine, 'Second');

    await engine.messages.send(projectId, first.taskId, { text: 'continue' });
    await engine.messages.send(projectId, second.taskId, { text: 'also continue' });
    await vi.waitFor(() => expect(delivered).toEqual([`${first.taskId}: continue`]));
    expect(db.getTaskRuntime(projectId).get(second.taskId)?.state).toBe('queued');
    expect(engine.scheduling.slots()).toEqual({ total: 1, free: 0 });

    // A message to the task whose turn runs joins that turn: it holds the slot already.
    await engine.messages.send(projectId, first.taskId, { text: 'one more thing' });
    expect(delivered).toHaveLength(2);

    await engine.events.onTurnCompleted(first, 'done');
    await vi.waitFor(() => expect(delivered).toContain(`${second.taskId}: also continue`));
    expect(db.getTaskRuntime(projectId).get(second.taskId)?.state).toBe('running');
  });
});
