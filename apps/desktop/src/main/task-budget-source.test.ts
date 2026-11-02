import { expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import {
  taskBudgetSource,
  taskBudgetSourcePaths,
  requireTaskBudgetPrefixes,
} from './credentials/task-budget-source';

// Pure registry/checkpoint DTO contracts. No journal, project/task/run or provider reply is seeded.
const source = {
  schema: 1 as const,
  projectId: '78bc2cd3-981b-40ed-a395-c6c6bc7da51b' as const,
  taskId: 'T-006' as const,
  runId: '4806ca85-4723-4828-87c3-69b56a0baae9',
  sessionId: '8dfb67f8-9ea4-49e8-a0b6-4b048526795c',
  sequence: 2,
  hash: 'a'.repeat(64),
};
const data = resolve('budget-contract');
const ledger = join(data, 'verification', 'openrouter-ba4');

it('constructs one primary source identity across repeated checkpoints and separate native sessions', () => {
  const first = taskBudgetSourcePaths(ledger, source);
  const later = taskBudgetSourcePaths(ledger, { ...source, sequence: 3, hash: 'b'.repeat(64) });
  expect(later.id).toBe(first.id);
  expect(later.journal).toBe(first.journal);
  expect(later.checkpoint).not.toBe(first.checkpoint);
  expect(first.journal.startsWith(join(data, 'builtin', 'tasks', source.runId))).toBe(true);
  expect(taskBudgetSourcePaths(ledger, { ...source, sessionId: source.runId }).id).not.toBe(
    first.id,
  );
});

it('rejects foreign scopes, supplied paths and noncanonical ledger roots', () => {
  for (const value of [
    { ...source, taskId: 'T-008' },
    { ...source, projectId: source.runId },
    { ...source, runId: '..' },
    { ...source, journal: '../other.jsonl' },
    { ...source, sequence: 0 },
  ])
    expect(() => taskBudgetSource.parse(value)).toThrow();
  for (const path of [
    'relative/verification/openrouter-ba4',
    join(data, 'other'),
    join(data, 'verification', 'other'),
  ])
    expect(() => taskBudgetSourcePaths(path, source)).toThrow('canonical');
});

it('requires every registered prefix and refuses truncation, substitution and mixed identities', () => {
  const hashes = [{ hash: '0'.repeat(64) }, { hash: source.hash }, { hash: 'b'.repeat(64) }];
  const later = { ...source, sequence: 3, hash: hashes[2]!.hash };
  expect(() => requireTaskBudgetPrefixes(hashes, [source, later])).not.toThrow();
  expect(() => requireTaskBudgetPrefixes(hashes.slice(0, 2), [source, later])).toThrow(
    'lost a registered prefix',
  );
  expect(() =>
    requireTaskBudgetPrefixes([{ hash: '0'.repeat(64) }, { hash: 'c'.repeat(64) }], [source]),
  ).toThrow('lost a registered prefix');
  expect(() =>
    requireTaskBudgetPrefixes(hashes, [source, { ...later, runId: source.sessionId }]),
  ).toThrow();
  expect(() => requireTaskBudgetPrefixes(hashes, [])).toThrow('no checkpoints');
});
