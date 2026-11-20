import { operationTimeout, persistsAfterTurn } from '@skaro/timeline';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { InputTurnBoundary } from './input-turn-boundary';

/** Hold the old slot until its specific terminal event arrives, or verify process-tree retirement. */
export async function interruptForNewInputs(
  ctx: TaskRunEngine,
  active: ActiveRun,
  turnId: string,
  current: () => void,
) {
  const { projectId, taskId } = active;
  const session = active.session;
  if (!session) throw new Error('Active task turn has no attached session');
  const transition = new InputTurnBoundary(turnId);
  active.inputTransition = transition;
  try {
    await operationTimeout(
      Promise.all([session.interrupt(), transition.completion]),
      15000,
      'Task did not confirm interruption for changed inputs',
    );
  } catch (error) {
    current();
    const outcome = active.timeline.state.turns.find((t) => t.id === turnId)?.outcome;
    if (outcome === 'failed') throw error;
    transition.retiring = true;
    ctx.deps.db.addEvent(projectId, 'task_interrupt_escalated', {
      task: taskId,
      turn: turnId,
      reason: String(error),
    });
    await ctx.sessions.detach(active, true);
    await active.pumping;
    current();
    if (!active.timeline.state.turns.find((t) => t.id === turnId)?.outcome) {
      for (const interaction of [...active.timeline.state.interactions])
        if (!persistsAfterTurn(interaction))
          ctx.history.skaroEvent(active, {
            t: 'interaction.closed',
            id: interaction.id,
            resolution: 'expired',
          });
      ctx.history.skaroEvent(active, {
        t: 'turn.completed',
        turnId,
        outcome: 'interrupted',
      });
    }
  }
  current();
  if (active.timeline.state.turns.find((t) => t.id === turnId)?.outcome === 'failed')
    throw new Error('The task turn failed before the input change was applied');
  // MCP handlers admitted before the interrupt may still be writing task state.
  await Promise.allSettled([...active.toolOperations]);
  current();
}
