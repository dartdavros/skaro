import { interruptForNewInputs } from './task-input-interruption';
import type { MessageInput } from '../shared/ipc';
import { requireCoordinationDispatch } from './coordination-dispatch';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { CommandCancelled } from './owner-commands';
import type { TaskInputSnapshot } from './task-preflight-inputs';
import { readTaskInputs, taskPreflight } from './task-preflight';
import { taskAgentInput } from './task-agent-input';
import { assertQuestionMessageAllowed } from '@skaro/timeline';
import { requireTaskNotStopping } from './builtin-task-stop';
import { hasOwnerCommand } from './owner-command-history';

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
  assertQuestionMessageAllowed(active.timeline.state, original.internal);
  const previous = ctx.deps.db.getSetting<TaskInputSnapshot | null>(
    `coordination.inputs.${run.id}`,
    null,
  );
  let inputs = await readTaskInputs(ctx, active);
  current();
  const turn = active.timeline.state.turns.at(-1);
  let replacing = false;
  let checkpointed = false;
  try {
    if (previous && previous.version !== inputs.snapshot.version && turn && !turn.outcome) {
      replacing = true;
      if (active.afterTurn) throw new Error('Task completion is already in progress');
      // Persist the original, still sealed input. Startup recovery validates dispatch and the
      // native echo before dispatching. Stop clears this same inbox.
      if (original.commandId) {
        ctx.startup.begin(
          projectId,
          taskId,
          [original],
          requireCoordinationDispatch(ctx.deps.db, projectId).revision,
          undefined,
          { runId: run.id, commandId: original.commandId },
        );
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
    assertQuestionMessageAllowed(active.timeline.state, input.internal);
    const latest = active.timeline.state.turns.at(-1);
    if (replacing && latest && !latest.outcome)
      throw new Error('A different turn started while task inputs were changing');
    const message = taskAgentInput(
      input,
      active.timeline.state,
      ctx.continuation.execution(active).read().followUp?.commandId === input.commandId &&
        !!input.commandId,
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
