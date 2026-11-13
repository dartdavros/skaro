import { randomUUID } from 'node:crypto';
import {
  resourceId,
  type AppDb,
  type ResourceRecord,
  type ResourceRegistration,
} from '@skaro/core';

export interface WorktreeRegistrationInput {
  resources?: AppDb['resources'];
  projectId: string;
  taskId: string;
  branch: string;
}

/** Record purpose before creation. Reusing legacy bytes never silently grants disposable ownership. */
export function initialWorktreeRegistration(
  input: WorktreeRegistrationInput,
  path: string,
  present: boolean,
  head: string,
): ResourceRegistration {
  return {
    projectId: input.projectId,
    kind: 'worktree',
    identity: { path },
    owner: present ? { kind: 'unknown', id: path } : { kind: 'task', id: input.taskId },
    purpose: present ? 'unknown' : 'worktree',
    ownership: present ? 'legacy-unverified' : 'registered',
    preservation: present ? 'unknown' : 'disposable',
    generation: 1,
    consumers: [],
    state: 'retained',
    source: { commit: head, recovery: input.branch },
  };
}

export function beginWorktreeResource(
  input: WorktreeRegistrationInput,
  path: string,
  present: boolean,
  head: string,
): ResourceRecord | undefined {
  const ledger = input.resources;
  if (!ledger) return undefined;
  const proposed = initialWorktreeRegistration(input, path, present, head);
  let record = ledger.get(resourceId(proposed));
  if (!record) return ledger.register(proposed);
  if (
    (record.owner.kind !== 'unknown' &&
      (record.owner.kind !== 'task' || record.owner.id !== input.taskId)) ||
    (record.ownership === 'registered' &&
      (record.purpose !== 'worktree' || record.preservation !== 'disposable')) ||
    (record.source?.recovery !== undefined && record.source.recovery !== input.branch)
  )
    throw new Error('Existing worktree resource belongs to a different owner or recovery branch');
  if (!present && record.state !== 'released') {
    if (record.consumers.length) throw new Error('Missing worktree resource still has consumers');
    // Absence is confirmed by lstat, not by an unreadable directory or a failed exists check.
    ledger.recordOutcome({
      operationId: randomUUID(),
      resourceId: record.id,
      generation: record.generation,
      action: 'inspect',
      state: 'observed',
      reason: 'worktree_path_absent',
    });
    record = ledger.update(record.id, record.revision, { state: 'released' });
  }
  return ledger.update(record.id, record.revision, {
    ...(record.state === 'released' ? { generation: record.generation + 1, consumers: [] } : {}),
    state: 'retained',
    source: { commit: head, recovery: input.branch },
  });
}

export function finishWorktreeResource(
  input: WorktreeRegistrationInput,
  captured: ResourceRecord | undefined,
  head: string,
  created: boolean,
): void {
  if (!input.resources || !captured) return;
  const record = input.resources.update(captured.id, captured.revision, {
    state: captured.ownership === 'registered' ? 'available' : 'retained',
    source: { commit: head, recovery: input.branch },
  });
  input.resources.recordOutcome({
    operationId: randomUUID(),
    resourceId: record.id,
    generation: record.generation,
    action: 'inspect',
    state: record.ownership === 'registered' ? 'observed' : 'retained',
    reason:
      record.ownership !== 'registered'
        ? 'legacy_ownership_unverified'
        : created
          ? 'worktree_created'
          : 'worktree_reused',
  });
}

export function failWorktreeResource(
  input: WorktreeRegistrationInput,
  captured?: ResourceRecord,
): void {
  if (!input.resources || !captured) return;
  const current = input.resources.get(captured.id);
  if (!current || current.generation !== captured.generation) return;
  if (current.revision === captured.revision)
    input.resources.update(current.id, current.revision, { state: 'error' });
  input.resources.recordOutcome({
    operationId: randomUUID(),
    resourceId: current.id,
    generation: current.generation,
    action: 'inspect',
    state: 'failed',
    reason: 'worktree_preparation_failed',
  });
}
