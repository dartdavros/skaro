import { join } from 'node:path';
import type { ChatEngine } from './chat-engine';
import { restoreHistory } from './restore-history';
import { decisionTimeline } from './decision-projection';
import type { DecisionSource } from '../shared/project-decisions';

export async function chatDecisionSources(
  ctx: ChatEngine,
  projectId: string,
  only?: string,
): Promise<DecisionSource[]> {
  const context = ctx.deps.projects.get(projectId),
    result: DecisionSource[] = [];
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
    result.push({
      projectId,
      kind: 'chat',
      id: chat.id,
      title: chat.title,
      epoch: chat.logPath,
      cwd: context.root,
      timeline: decisionTimeline(
        timeline,
        !!live?.session && timeline.turns.some((turn) => !turn.outcome),
      ),
    });
  }
  return result;
}
