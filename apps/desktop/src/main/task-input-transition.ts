import { interruptForNewInputs } from './task-input-interruption';
import type { MessageInput } from '../shared/ipc';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { CommandCancelled } from './owner-commands';
import type { TaskInputSnapshot } from './task-preflight-inputs';
import { readTaskInputs, taskPreflight } from './task-preflight';
import { taskAgentInput } from './task-agent-input';
import { assertQuestionMessageAllowed } from '@skaro/timeline';
import { requireTaskNotStopping } from './builtin-task-stop';
import { hasOwnerCommand } from './owner-command-history';
import { QuestionAnswers } from './question-answers';
import { isTaskParked } from '@skaro/core';
import { currentTransition } from './task-lifecycle-journal';
import { ownerResumeText, prepareTaskFollowUp } from './task-follow-up';
import { FINISH } from './task-wait-card';
import { confirmTaskResume } from './task-resume';

/** One serialized delivery owns the old turn, its queue slot and its replacement. */
export async function deliverTaskInput(
  ctx: TaskRunEngine,
  active: ActiveRun,
  original: MessageInput,
  epoch: number,
) {
  const { projectId, taskId, run } = active;
  const current = () => {
    requireTaskNotStopping(active);
    if (
      ctx.closing ||
      ctx.messages.stopping(projectId, taskId) ||
      ctx.parking.has(`${projectId}\n${taskId}`) ||
      active.switching ||
      active.run.id !== run.id ||
      ctx.active.get(`${projectId}\n${taskId}`) !== active ||
      epoch !== active.deliveryEpoch ||
      !ctx.continuation.canDeliver(active, original) ||
      (original.commandId && ctx.deps.db.commands.get(original.commandId)?.state === 'cancelled')
    )
      throw new CommandCancelled();
  };
  current();
  if (hasOwnerCommand(active.timeline.state, original.commandId)) return;
  const previousTransition = currentTransition(ctx.deps.db, projectId, taskId);
  if (previousTransition && previousTransition.phase !== 'settled') throw new CommandCancelled();
  assertQuestionMessageAllowed(active.timeline.state, original.internal);
  const previous = ctx.deps.db.getSetting<TaskInputSnapshot | null>(
    `coordination.inputs.${run.id}`,
    null,
  );
  let inputs = await readTaskInputs(ctx, active);
  current();
  const task = inputs.artifacts.tasks.find((item) => item.id === taskId);
  const parked = !!task && isTaskParked(task.status);
  if (parked && original.internal) throw new CommandCancelled();
  const execution = ctx.continuation.execution(active);
  const answers = new QuestionAnswers(ctx.deps.db, `active.${run.id}`);
  const pendingAnswer = answers.pending(active.timeline.state);
  if (pendingAnswer?.resumeTask && original.commandId === pendingAnswer.commandId) {
    original = prepareTaskFollowUp(execution, original, active.timeline.state, pendingAnswer);
  } else if ((parked || original.resumeTask) && !original.commandId?.startsWith('answers-')) {
    original = prepareTaskFollowUp(execution, original, active.timeline.state, pendingAnswer);
  }
  const turn = active.timeline.state.turns.at(-1);
  let replacing = false;
  let checkpointed = false;
  try {
    if (
      previous &&
      turn &&
      !turn.outcome &&
      (previous.version !== inputs.snapshot.version ||
        answers.replacesNativeTurn(original.commandId, turn.id))
    ) {
      replacing = true;
      if (active.afterTurn) throw new Error('Task completion is already in progress');
      // Persist the original, still sealed input. Startup recovery validates dispatch and the
      // native echo before dispatching. Stop clears this same inbox.
      if (original.commandId) {
        ctx.startup.begin(projectId, taskId, [original], undefined, {
          runId: run.id,
          commandId: original.commandId,
        });
        checkpointed = true;
      }
      ctx.deps.db.addEvent(projectId, 'task_inputs_interrupt_requested', {
        task: taskId,
        run: run.id,
        turn: turn.id,
        previous: previous.version,
        current: inputs.snapshot.version,
        command: original.commandId,
      });
      await interruptForNewInputs(ctx, active, turn.id, current);
      inputs = await readTaskInputs(ctx, active);
    }
    current();
    // Permissions and environment variables are bound at session creation.
    if (
      previous &&
      active.session &&
      (previous.authority !== inputs.snapshot.authority ||
        previous.environment !== inputs.snapshot.environment)
    )
      await ctx.sessions.detach(active, true);
    current();
    const input = await taskPreflight(
      ctx,
      active,
      active.secrets.input(original),
      inputs,
      previous,
    );
    current();
    const session = await ctx.sessions.attach(active);
    current();
    const subject = inputs.artifacts.tasks.find((item) => item.id === taskId);
    const finish =
      original.resumeTask &&
      original.commandId?.startsWith('answers-') &&
      execution.matchesFollowUp(original.commandId, FINISH);
    const instruction = finish ? FINISH : ownerResumeText(original, pendingAnswer);
    const resumed = !!(
      subject &&
      original.commandId &&
      instruction &&
      (isTaskParked(subject.status) || original.resumeTask) &&
      (await confirmTaskResume(
        ctx,
        active,
        subject,
        inputs.snapshot.version,
        original.commandId,
        instruction,
        current,
      ))
    );
    current();
    assertQuestionMessageAllowed(active.timeline.state, input.internal);
    const latest = active.timeline.state.turns.at(-1);
    if (replacing && latest && !latest.outcome)
      throw new Error('A different turn started while task inputs were changing');
    const message = taskAgentInput(
      input,
      active.timeline.state,
      execution.read().followUp?.commandId === input.commandId && !!input.commandId,
      resumed,
    );
    // Once a native write is possible the durable owner-command receipt governs uncertain delivery.
    ctx.startup.consumeTransition(projectId, taskId, run.id, original.commandId);
    active.inputTransition = undefined;
    if (!latest || latest.outcome) await session.send(message, input.commandId);
    else await session.steer(message, input.commandId);
  } catch (error) {
    if (replacing) {
      if (
        checkpointed &&
        epoch === active.deliveryEpoch &&
        !ctx.closing &&
        !(error instanceof CommandCancelled)
      )
        ctx.startup.fail(projectId, taskId, String(error));
      if (active.stopError || active.timeline.state.turns.at(-1)?.outcome) {
        active.release?.();
        active.release = undefined;
        ctx.events.settleRuntime(active);
      }
    }
    throw error;
  } finally {
    active.inputTransition = undefined;
  }
}
