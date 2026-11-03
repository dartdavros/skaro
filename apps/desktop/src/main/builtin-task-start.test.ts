import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { TaskStartup } from './task-startup';
import { parseBuiltinTaskStart } from './builtin-task-start';
import { capturePendingBuiltinStart, requirePendingBuiltinStart } from './builtin-task-pending';

const selected = {
  agent: 'skaro' as const,
  model: 'route-marker',
  permissionMode: 'ask' as const,
  planFirst: true,
  isolation: 'worktree' as const,
};

it('requires exact builtin launch choices without inheriting permission, agent or provider defaults', () => {
  expect(parseBuiltinTaskStart(selected)).toEqual(selected);
  for (const value of [
    null,
    { ...selected, agent: 'codex' },
    { ...selected, model: '' },
    { ...selected, permissionMode: undefined },
    { ...selected, permissionMode: 'unknown' },
    { ...selected, isolation: undefined },
    { ...selected, planFirst: 'true' },
    { ...selected, effort: '' },
    { ...selected, endpoint: 'https://elsewhere.example' },
  ])
    expect(() => parseBuiltinTaskStart(value)).toThrow('exact route');
});

it('retains the builtin selection with durable startup input/error and revokes it on cancellation', () => {
  // Real SQLite settings only. No project/task/run, ActiveRun, backend or model is seeded.
  const db = AppDb.open(':memory:');
  try {
    const startup = new TaskStartup(db);
    const settings = parseBuiltinTaskStart(selected);
    startup.selectBuiltin('startup-marker', 'task-marker', settings);
    const input = { text: 'Exact owner startup input', commandId: randomUUID() };
    expect(startup.begin('startup-marker', 'task-marker', [input])).toEqual([input]);
    const captured = startup.read('startup-marker', 'task-marker')!.builtin!;
    const requireCurrent = capturePendingBuiltinStart(
      startup,
      'startup-marker',
      'task-marker',
      () => false,
    );
    const epoch = startup.cancellationEpoch('startup-marker', 'task-marker');
    startup.fail('startup-marker', 'task-marker', 'Actual startup did not run');
    const restored = new TaskStartup(db);
    expect(restored.read('startup-marker', 'task-marker')).toMatchObject({
      builtin: settings,
      inputs: [input],
      error: 'Actual startup did not run',
    });
    expect(restored.begin('startup-marker', 'task-marker', [input])).toEqual([input]);
    expect(restored.retryBuiltin('startup-marker', 'task-marker', settings, input)).toBe(true);
    expect(() =>
      restored.retryBuiltin('startup-marker', 'task-marker', settings, {
        ...input,
        text: 'Changed input',
      }),
    ).toThrow('exact pending');
    expect(() =>
      restored.retryBuiltin(
        'startup-marker',
        'task-marker',
        { ...settings, permissionMode: 'full' },
        input,
      ),
    ).toThrow('exact pending');
    expect(() =>
      requirePendingBuiltinStart(restored.read('startup-marker', 'task-marker')!.builtin, captured),
    ).not.toThrow();
    expect(() => restored.selectBuiltin('startup-marker', 'task-marker', settings)).toThrow(
      'pending owner input',
    );
    restored.cancel('startup-marker', 'task-marker');
    expect(() => requireCurrent()).toThrow('cancelled');
    expect(restored.read('startup-marker', 'task-marker')).toBeUndefined();
    expect(() =>
      requirePendingBuiltinStart(restored.read('startup-marker', 'task-marker')?.builtin, captured),
    ).toThrow('cancelled');
    expect(() =>
      requirePendingBuiltinStart({ ...settings, permissionMode: 'full' }, captured),
    ).toThrow('cancelled');
    expect(() => requirePendingBuiltinStart(settings, captured, true)).toThrow('cancelled');
    restored.selectBuiltin('startup-marker', 'task-marker', settings);
    expect(() => requireCurrent()).toThrow('cancelled');
    const replacement = capturePendingBuiltinStart(
      restored,
      'startup-marker',
      'task-marker',
      () => false,
    );
    expect(() => replacement()).not.toThrow();
    const beforeDelivery = restored.cancellationEpoch('startup-marker', 'task-marker');
    restored.delivered('startup-marker', 'task-marker');
    expect(restored.cancellationEpoch('startup-marker', 'task-marker')).toBe(beforeDelivery);
    expect(restored.cancellationEpoch('startup-marker', 'task-marker')).toBeGreaterThan(epoch);
    expect(() => replacement()).toThrow('cancelled');
    expect(db.listProjects()).toEqual([]);
    expect(db.listRuns('startup-marker')).toEqual([]);
  } finally {
    db.close();
  }
});
