import { isAsyncQuestion, type Interaction, type InteractionAnswer } from '@skaro/timeline';
import { acceptQuestionReply } from './accept-question-reply';
import { DecisionNotDispatched } from './decision-not-dispatched';
import { decisionItemId } from './decision-item-id';
import { recordQuestionAcceptance } from './question-answer-proof';
import { QuestionAnswers } from './question-answers';
import { taskInputsCurrent } from './task-preflight';
import type { TaskRunEngine } from './task-run-engine';
import { key } from './task-run-helpers';
import type { ActiveRun } from './task-run-model';
import { recoverWaitingTaskSuspension } from './task-suspension';
import { errorText } from './session-log';

/** Only informational replies may cross an input revision. Permissions belong to the old turn. */
export function replacementQuestion(
  interaction: Interaction,
  current: boolean,
  replacementPending: boolean,
): Extract<Interaction, { kind: 'question' }> | undefined {
  if (interaction.kind === 'question')
    return !current || replacementPending ? interaction : undefined;
  if (!current)
    throw new DecisionNotDispatched('Task inputs changed before this decision could be dispatched');
  return undefined;
}

/** A native decision belongs to one session. An informational answer can survive its replacement. */
export async function dispatchTaskReply(
  ctx: TaskRunEngine,
  active: ActiveRun,
  interaction: Interaction,
  answer: InteractionAnswer,
): Promise<'native' | 'queued'> {
  const { run, session, projectId, taskId, deliveryEpoch } = active;
  const state = active.timeline.state;
  const turn = state.turns.at(-1);
  const turnId = turn?.id;
  const outcome = turn?.outcome;
  const owner = `active.${run.id}`;
  const queueAnswer = (
    question: Extract<Interaction, { kind: 'question' }>,
    replaceNativeTurn = false,
  ) => {
    acceptQuestionReply(
      ctx.deps.db,
      owner,
      question,
      answer,
      state,
      (event) => ctx.history.skaroEvent(active, event),
      'task.send',
      projectId,
      taskId,
      replaceNativeTurn,
    );
    return 'queued' as const;
  };
  const requireOpen = (native = false) => {
    const latest = state.turns.at(-1);
    if (
      ctx.closing ||
      active.stopping ||
      active.switching ||
      active.inputTransition ||
      active.deliveryEpoch !== deliveryEpoch ||
      active.run.id !== run.id ||
      ctx.active.get(key(projectId, taskId)) !== active ||
      latest?.id !== turnId ||
      (native && (active.session !== session || latest?.outcome !== outcome)) ||
      !state.interactions.includes(interaction)
    )
      throw new DecisionNotDispatched(
        'The task or its open request changed before the reply was sent',
      );
  };
  const shutdownFailure = (error: unknown) =>
    new DecisionNotDispatched(
      `Reply not sent. Agent shutdown could not be confirmed. ${errorText(error)}`,
    );
  requireOpen();
  if (
    interaction.kind === 'question' &&
    (isAsyncQuestion(interaction) || !session || !turn || outcome)
  ) {
    try {
      await recoverWaitingTaskSuspension(ctx, active);
    } catch (error) {
      throw shutdownFailure(error);
    }
    requireOpen();
    if (active.stopError) throw shutdownFailure(active.stopError);
    return queueAnswer(interaction);
  }
  requireOpen(true);
  if (active.stopError) throw shutdownFailure(active.stopError);
  if (!session) throw new DecisionNotDispatched('The agent session has ended');
  let current: boolean;
  try {
    current = await taskInputsCurrent(ctx, active);
  } catch (error) {
    throw new DecisionNotDispatched(error);
  }
  requireOpen(true);
  if (active.stopError) throw shutdownFailure(active.stopError);
  const replacementPending =
    interaction.kind === 'question' &&
    !!turnId &&
    current &&
    new QuestionAnswers(ctx.deps.db, owner).awaitingNativeReplacement(turnId);
  const replacement = replacementQuestion(interaction, current, replacementPending);
  if (replacement) return queueAnswer(replacement, true);
  const nativeId = run.previousRunId ? interaction.id.replace(`${run.id}:`, '') : interaction.id;
  await session.respond(nativeId, answer);
  if (interaction.kind === 'question')
    recordQuestionAcceptance(
      ctx.deps.db,
      owner,
      interaction,
      answer,
      turnId,
      decisionItemId(run.id, turnId, interaction.id),
    );
  return 'native';
}
