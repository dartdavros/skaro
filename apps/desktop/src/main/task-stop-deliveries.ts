import type { AppDb, CoordinationOperation, OwnerCommand } from '@skaro/core';
import type { MessageInput } from '../shared/ipc';
import { isTaskContinuationInput } from './integration-routing';
import { currentTransition } from './task-lifecycle-journal';
import { coordinationHash } from './project-coordinator-request';
import { hasTaskDestination } from './owner-command-provenance';

/** Old internal continuations bypassed the resolver. New resumes record their destination at acceptance. */
function isTaskOnly(db: AppDb, command: OwnerCommand | undefined, project: string, task: string) {
  const input = command?.args[2] as MessageInput | undefined;
  return (
    !!command &&
    command.method === 'task.send' &&
    command.args[0] === project &&
    command.args[1] === task &&
    command.owner === `${project}:${task}` &&
    input?.commandId === command.id &&
    (isTaskContinuationInput(input) ||
      (input.resumeTask === true && hasTaskDestination(db, command)))
  );
}

export function taskStopDeliveries(
  db: AppDb,
  project: string,
  task: string,
  ids: string[],
  shared: boolean,
) {
  return shared ? ids.filter((id) => isTaskOnly(db, db.commands.get(id), project, task)) : ids;
}

/** An old unresolved task-only delivery can be retired by an already verified, later Stop. */
export function savedTaskStop(db: AppDb, command: OwnerCommand, operation: CoordinationOperation) {
  const [project, task] = command.args as [string, string];
  if (
    !isTaskOnly(db, command, project, task) ||
    operation.state !== 'uncertain' ||
    operation.inputHash !== coordinationHash(command.args) ||
    operation.subject.kind !== 'task' ||
    operation.subject.id !== task ||
    operation.scopeKey !== `delivery:task:${task}`
  )
    return;
  const entry = currentTransition(db, project, task);
  if (entry?.phase !== 'settled' || entry.target === 'in_progress' || !entry.run) return;
  const run = db.latestRun(project, task);
  if (run?.id !== entry.run || run.agent === 'skaro') return;
  const proof = db.getSetting<{ state: string; at: number; epoch: number } | undefined>(
    `native.task-stop.${run.id}`,
    undefined,
    { strict: true },
  );
  if (
    proof?.state !== 'verified' ||
    !Number.isSafeInteger(proof.at) ||
    proof.at <= operation.updatedAt
  )
    return;
  // The caller revalidates every run and recorded process immediately before reconciliation.
  return { kind: 'run' as const, id: run.id, version: proof.epoch };
}
