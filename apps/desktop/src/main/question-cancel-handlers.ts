import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import type { ChatEngine } from './chat-engine';
import type { LiveChat } from './chat-model';
import { cancelQuestionRequests, type QuestionCancellationContext } from './question-cancellation';
import { trackRun } from './task-run-access';
import { DecisionNotDispatched } from './decision-not-dispatched';
import { cancelIncidentQuestion } from './incident-question-cancel';

export function taskQuestionContext(
  ctx: TaskRunEngine,
  active: ActiveRun,
): QuestionCancellationContext {
  return {
    db: ctx.deps.db,
    owner: `active.${active.run.id}`,
    state: active.timeline.state,
    emit: (event) => ctx.history.skaroEvent(active, event),
    retireShared: (id, reason) => cancelIncidentQuestion(ctx, active.projectId, id, reason),
    flush: () => {
      ctx.history.flush(active);
      ctx.events.settleRuntime(active);
      ctx.changed(active.projectId, active.taskId);
    },
    ...(active.session ? { interrupt: () => active.session!.interrupt() } : {}),
  };
}

export function chatQuestionContext(ctx: ChatEngine, live: LiveChat): QuestionCancellationContext {
  return {
    db: ctx.deps.db,
    owner: `live.${live.chat.id}`,
    state: live.timeline.state,
    emit: (event) => ctx.history.skaroEvent(live, event),
    flush: () => {
      ctx.history.flush(live);
      ctx.listChanged(live.projectId, live.chat.id);
    },
    ...(live.session ? { interrupt: () => live.session!.interrupt() } : {}),
  };
}

export async function cancelTaskQuestion(
  ctx: TaskRunEngine,
  project: string,
  task: string,
  id: string,
  reason: string,
  runId?: string,
) {
  if (runId && ctx.deps.db.listRuns(project, task)[0]?.id !== runId)
    throw new DecisionNotDispatched('Question owner changed');
  if (await ctx.integrations.controls.cancelQuestion(project, task, id, reason)) return;
  const active = await ctx.history.restore(project, task);
  if (!active || (runId && active.run.id !== runId))
    throw new DecisionNotDispatched('Question owner changed');
  return trackRun(active, async () => {
    const question = active.timeline.state.interactions.find((q) => q.id === id);
    if (question?.kind !== 'question')
      throw new DecisionNotDispatched('Question is no longer open');
    await cancelQuestionRequests(taskQuestionContext(ctx, active), [question], reason);
  });
}

export async function cancelChatQuestion(
  ctx: ChatEngine,
  project: string,
  chat: string,
  id: string,
  reason: string,
) {
  const live = await ctx.history.restore(project, chat);
  if (live.chat.archived) throw new DecisionNotDispatched('The chat is archived');
  const question = live.timeline.state.interactions.find((q) => q.id === id);
  if (question?.kind !== 'question') throw new DecisionNotDispatched('Question is no longer open');
  await cancelQuestionRequests(chatQuestionContext(ctx, live), [question], reason);
}
