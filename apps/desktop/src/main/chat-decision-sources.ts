import { join } from 'node:path';
import type { ChatEngine } from './chat-engine';
import { restoreHistory } from './restore-history';
import { decisionTimeline } from './decision-projection';
import type { DecisionSource } from '../shared/project-decisions';
import { QuestionAnswers } from './question-answers';
import { taskProposalCurrent } from './task-decision-lifecycle';

export async function chatDecisionSources(
  ctx: ChatEngine,
  projectId: string,
  only?: string,
): Promise<DecisionSource[]> {
  const context = ctx.deps.projects.get(projectId),
    result: DecisionSource[] = [];
  const artifacts = await context.summary();
  for (const chat of ctx.deps.db.listChats(projectId)) {
    if (chat.archived || (only && chat.id !== only)) continue;
    const live = ctx.live.get(chat.id);
    const timeline =
      live?.timeline.state ??
      (
        await restoreHistory(
          ctx.deps.dataDir,
          join(ctx.deps.dataDir, chat.logPath),
          chat.createdAt,
          chat.agent,
          projectId,
        )
      ).timeline.state;
    const projected = decisionTimeline(
      new QuestionAnswers(ctx.deps.db, `live.${chat.id}`).project(timeline),
      !!live?.session && timeline.turns.some((turn) => !turn.outcome),
    );
    projected.items = projected.items.filter((item) => taskProposalCurrent(item, artifacts.tasks));
    result.push({
      projectId,
      kind: 'chat',
      id: chat.id,
      title: chat.title,
      epoch: chat.logPath,
      cwd: context.root,
      timeline: projected,
    });
  }
  return result;
}
