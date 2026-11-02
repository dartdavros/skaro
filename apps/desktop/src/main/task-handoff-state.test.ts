import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { handoffInputs } from './task-handoff-inputs';
import { handoffAgentName } from './task-handoff-settings';
import { TaskExecution } from './task-execution';

it('retains ordered durable startup and queue inputs without duplicates or conflicting IDs', () => {
  const first = { commandId: 'first', text: 'Exact pending input' };
  const second = { commandId: 'second', text: 'Later input' };
  const combined = handoffInputs([first], [{ ...first }, second]);
  expect(combined).toEqual([first, second]);
  first.text = 'Caller changed its object';
  expect(combined[0]!.text).toBe('Exact pending input');
  expect(() => handoffInputs([second], [{ ...second, text: 'Different input' }])).toThrow(
    'Conflicting pending',
  );
});

it('retains a stop, blocker and stall bound across handoff without reusing old turn IDs', () => {
  // Actual SQLite settings, with no project/task/run or model response seeded.
  const db = AppDb.open(':memory:');
  try {
    const previous = new TaskExecution(db, 'previous-marker');
    previous.start();
    previous.next('old-first', 'unchanged');
    previous.next('old-second', 'unchanged');
    previous.block('Actual external prerequisite is unavailable');
    previous.stop();
    const successor = new TaskExecution(db, 'successor-marker');
    successor.inherit(previous.read());
    expect(successor.read()).toEqual({
      enabled: false,
      blocked: 'Actual external prerequisite is unavailable',
      stalls: 1,
      fingerprint: 'unchanged',
    });
    expect(successor.next('new-first', 'unchanged')).toBe('stalled');
    successor.inherit({ enabled: true, stalls: 0 });
    expect(successor.read().enabled).toBe(false);
    expect(db.listProjects()).toEqual([]);
    expect(db.listRuns('previous-marker')).toEqual([]);
  } finally {
    db.close();
  }
});

it('resolves the existing agent names without requiring bundled runtime product activation', () => {
  expect(handoffAgentName('skaro')).toBe('Skaro');
  expect(handoffAgentName('claude-code')).toBe('Claude Code');
  expect(handoffAgentName('codex')).toBe('Codex');
  expect(() => handoffAgentName('unknown')).toThrow('Unknown agent');
});
