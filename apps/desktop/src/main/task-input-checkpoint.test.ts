import { AppDb } from '@skaro/core';
import { expect, it } from 'vitest';
import { TaskStartup } from './task-startup';

it('recovers one pending replacement, fences a different run and cancels the replacement on Stop', () => {
  const db = AppDb.open(':memory:');
  try {
    const input = { text: 'Read the revised task', commandId: 'revision' };
    const next = { text: 'Report progress', commandId: 'progress' };
    const transition = { runId: 'original', commandId: input.commandId };
    const startup = new TaskStartup(db);
    startup.begin('project', 'task', [input], 1, transition);
    const restored = new TaskStartup(db);
    restored.begin('project', 'task', [input, next], 1);
    expect(restored.read('project', 'task')?.inputs).toEqual([input, next]);
    expect(() =>
      restored.consumeTransition('project', 'task', 'replacement', input.commandId),
    ).toThrow('different task run');
    restored.consumeTransition('project', 'task', 'original', input.commandId);
    expect(restored.read('project', 'task')?.inputs).toEqual([next]);
    restored.begin('project', 'task', [input], 1, transition);
    restored.cancel('project', 'task');
    expect(new TaskStartup(db).read('project', 'task')).toBeUndefined();
  } finally {
    db.close();
  }
});
