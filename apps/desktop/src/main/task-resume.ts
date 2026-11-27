import { assertQuestionsAnswered, type TimelineState } from '@skaro/timeline';
import type { SkaroScope, ToolResult } from '@skaro/mcp-server';
import type { TaskExecution } from './task-execution';
import { awaitsDecision } from './task-wait-card';
import { incidentSubscribers, isTaskParked, type Task } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { readTaskInputs } from './task-preflight';
import { CommandCancelled } from './owner-commands';
import { key } from './task-run-helpers';
import { requireTaskNotStopping } from './builtin-task-stop';
import { resumeParkedTask } from './task-park';
import { beginTransition, currentTransition, transitionPhase } from './task-lifecycle-journal';
import type { ActiveRun } from './task-run-model';
import { reportLifecycleConflict } from './task-lifecycle-conflict';
import { RESUMED_ENVIRONMENT } from './task-agent-input';
import { taskC4WaitPolicy } from './c4-package-policy';
import type { TaskC4WaitPolicy } from '../shared/feed-actions';

export function taskAcceptsContinuation(task: Pick<Task, 'archived' | 'status'>): boolean {
  return (
    !task.archived &&
    (task.status === 'in_progress' || task.status === 'review' || isTaskParked(task.status))
  );
}

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
  if (!subject || !taskAcceptsContinuation(subject))
    return { text: 'The current task state does not allow execution.', isError: true };
  if (
    !(await confirmTaskResume(
      ctx,
      active,
      subject,
      snapshot.version,
      commandId,
      instruction,
      current,
    ))
  )
    return { text: 'No matching current owner instruction.', isError: true };
  const blocker = execution.read().blockedIncident;
  const incident = blocker && ctx.deps.db.coordination.blockers.get(project, blocker);
  const text = 'Task execution resumed for the current owner instruction.';
  return incident && incident.state === 'open' && incident.protocol?.cause === 'environment'
    ? { text: `${text} ${RESUMED_ENVIRONMENT}` }
    : { text };
}

/** A recorded owner submission authorizes execution independently of native delivery. */
export async function confirmTaskResume(
  ctx: TaskRunEngine,
  active: ActiveRun,
  subject: Pick<Task, 'archived' | 'status'>,
  inputs: string,
  commandId: string,
  instruction: string,
  current: () => void,
): Promise<boolean> {
  const { projectId: project, taskId: task } = active;
  if (!taskAcceptsContinuation(subject)) return false;
  current();
  const execution = ctx.continuation.execution(active);
  const db = ctx.deps.db;
  const { resumed, transition } = db.settings.atomic(() => {
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
    const resumed = execution.resume(commandId, instruction, !!environment);
    if (!resumed) return { resumed };
    if (environment) {
      const subscriptions = incidentSubscribers(environment.protocol!.subscriptions, {
        taskId: task,
        runId: active.run.id,
        inputs,
        intent: execution.intentVersion(),
      });
      ctx.incidents.store.update(environment, { subscriptions });
    }
    if (!isTaskParked(subject.status)) return { resumed };
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
    // The confirmed intent can finish its board write after a restart.
    transitionPhase(db, project, transition, 'confirmed');
    return { resumed, transition };
  });
  if (transition) {
    try {
      await resumeParkedTask(ctx, project, task, current);
      current();
      transitionPhase(db, project, transition, 'settled');
      ctx.changed(project, task);
    } catch (error) {
      if (!(error instanceof CommandCancelled))
        await reportLifecycleConflict(ctx, project, transition);
      throw error;
    }
  }
  return resumed;
}
