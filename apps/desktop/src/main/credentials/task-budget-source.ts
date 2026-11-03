import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { builtinSessionDirectory } from '../builtin-session-directory';

export interface TaskBudgetSource {
  schema: 1;
  projectId: '78bc2cd3-981b-40ed-a395-c6c6bc7da51b';
  taskId: 'T-006';
  runId: string;
  sessionId: string;
  sequence: number;
  hash: string;
}
const uuid = (value: unknown) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export const taskBudgetSource = {
  parse(input: unknown): TaskBudgetSource {
    const value = input as Partial<TaskBudgetSource> | null;
    if (
      !value ||
      typeof value !== 'object' ||
      value.schema !== 1 ||
      Object.keys(value).sort().join(',') !==
        'hash,projectId,runId,schema,sequence,sessionId,taskId' ||
      value.projectId !== '78bc2cd3-981b-40ed-a395-c6c6bc7da51b' ||
      value.taskId !== 'T-006' ||
      !uuid(value.runId) ||
      !uuid(value.sessionId) ||
      !Number.isSafeInteger(value.sequence) ||
      Number(value.sequence) <= 0 ||
      typeof value.hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.hash)
    )
      throw new Error('Invalid task budget source');
    return structuredClone(value) as TaskBudgetSource;
  },
};

/** Paths are constructed from validated identities; registry records cannot supply a file path. */
export function taskBudgetSourceId(runId: string, sessionId: string) {
  assert(uuid(runId) && uuid(sessionId), 'Invalid task budget identity');
  return createHash('sha256')
    .update(JSON.stringify([runId, sessionId]))
    .digest('hex');
}

export function taskBudgetSourcePaths(ledger: string, input: TaskBudgetSource) {
  const value = taskBudgetSource.parse(input);
  if (
    ledger !== resolve(ledger) ||
    ledger !== join(resolve(ledger, '../..'), 'verification', 'openrouter-ba4')
  )
    throw new Error('Task budget source requires the canonical acceptance ledger');
  const data = resolve(ledger, '../..');
  const id = taskBudgetSourceId(value.runId, value.sessionId);
  return {
    id,
    journal: join(
      builtinSessionDirectory(data, 'tasks', value.runId, value.sessionId),
      'journal.jsonl',
    ),
    checkpoint: join(ledger, 'task-sources', `${id}-${value.sequence}.json`),
  };
}

export function requireTaskBudgetPrefixes(
  records: readonly { hash: string }[],
  checkpoints: readonly TaskBudgetSource[],
) {
  const first = checkpoints[0];
  assert(first, 'Task budget source has no checkpoints');
  for (const point of checkpoints) {
    taskBudgetSource.parse(point);
    assert.equal(point.runId, first.runId);
    assert.equal(point.sessionId, first.sessionId);
    assert.equal(
      records[point.sequence - 1]?.hash,
      point.hash,
      'Task budget journal lost a registered prefix',
    );
  }
}
