import { assertQuestionsAnswered, type TimelineState } from '@skaro/timeline';
import type { SkaroScope, ToolResult } from '@skaro/mcp-server';
import type { TaskExecution } from './task-execution';
import { awaitsDecision } from './task-wait-card';
import { taskC4WaitPolicy } from './c4-package-policy';
import type { TaskC4WaitPolicy } from '../shared/feed-actions';
import { incidentSubscribers, isTaskParked } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { readTaskInputs } from './task-preflight';
import { CommandCancelled } from './owner-commands';
import { key } from './task-run-helpers';
import { requireTaskNotStopping } from './builtin-task-stop';
import { resumeParkedTask } from './task-park';
import { beginTransition, currentTransition, transitionPhase } from './task-lifecycle-journal';

export function resumeTaskExecution(
  execution: TaskExecution,
  state: TimelineState,
  commandId: string,
  instruction: string,
  retainBlocker = false,
  blocksC4?: TaskC4WaitPolicy,
): ToolResult {
  assertQuestionsAnswered(state);
  if (awaitsDecision(state, blocksC4))
    return { text: 'Answer the pending proposal before continuing.', isError: true };
  return execution.resume(commandId, instruction, retainBlocker)
    ? { text: 'Task execution resumed for the current owner instruction.' }
    : {
        text: 'No matching current owner instruction. Answer the message and stop.',
        isError: true,
      };
}

/** A task-feed instruction can authorize work without a separate panel action. */
export async function resumeTaskFromInstruction(
  ctx: TaskRunEngine,
  scope: SkaroScope,
  commandId: string,
  instruction: string,
): Promise<ToolResult> {
  const project = scope.projectId;
  const task = scope.taskId!;
  const owner = key(project, task);
  const active = ctx.requireActive(project, task);
  const epoch = active.deliveryEpoch;
  const execution = ctx.continuation.execution(active);
  const blocksC4 = taskC4WaitPolicy(ctx.deps.db, project, active.run.id);
  const current = () => {
    requireTaskNotStopping(active);
    if (
      ctx.closing ||
      ctx.parking.has(owner) ||
      ctx.active.get(owner) !== active ||
      active.switching ||
      active.run.id !== scope.runId ||
      epoch !== active.deliveryEpoch ||
      !execution.matchesFollowUp(commandId, instruction)
    )
      throw new CommandCancelled();
    assertQuestionsAnswered(active.timeline.state);
    if (awaitsDecision(active.timeline.state, blocksC4)) throw new CommandCancelled();
  };
  if (!execution.matchesFollowUp(commandId, instruction))
    return resumeTaskExecution(
      execution,
      active.timeline.state,
      commandId,
      instruction,
      false,
      blocksC4,
    );
  const { artifacts, snapshot } = await readTaskInputs(ctx, active);
  const subject = artifacts.tasks.find((item) => item.id === task);
  if (
    !subject ||
    subject.archived ||
    (!isTaskParked(subject.status) && subject.status !== 'in_progress')
  )
    return { text: 'The current task state does not allow execution.', isError: true };
  current();
  const db = ctx.deps.db;
  const { result, transition } = db.settings.atomic(() => {
    const pending = currentTransition(db, project, task);
    if (
      pending &&
      pending.phase !== 'settled' &&
      (pending.target !== 'in_progress' || pending.commandId !== commandId)
    )
      throw new CommandCancelled();
    const id = execution.read().blockedIncident;
    const row = id && db.coordination.blockers.get(project, id);
    const environment =
      row && row.state === 'open' && row.protocol?.cause === 'environment' ? row : undefined;
    const result = resumeTaskExecution(
      execution,
      active.timeline.state,
      commandId,
      instruction,
      !!environment,
      blocksC4,
    );
    if (result.isError) return { result };
    if (environment) {
      const subscriptions = incidentSubscribers(environment.protocol!.subscriptions, {
        taskId: task,
        runId: active.run.id,
        inputs: snapshot.version,
        intent: execution.intentVersion(),
      });
      ctx.incidents.store.update(environment, { subscriptions });
    }
    if (!isTaskParked(subject.status)) return { result };
    const transition =
      pending && pending.phase !== 'settled'
        ? pending
        : beginTransition(db, project, {
            id: task,
            run: active.run.id,
            target: 'in_progress',
            from: subject.status,
            commandId,
          });
    // The live agent receiving and quoting this command proves delivery, even if the native
    // transport acknowledgement has not arrived yet. Recovery can finish the board write.
    transitionPhase(db, project, transition, 'confirmed');
    return { result, transition };
  });
  if (transition) {
    await resumeParkedTask(ctx, project, task, current);
    current();
    transitionPhase(db, project, transition, 'settled');
    ctx.changed(project, task);
  }
  return result;
}
