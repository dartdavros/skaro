import { isAuditChat } from './c4-audit-admission';
import type { TimelineState } from '@skaro/timeline';
import type { ChatEngine } from './chat-engine';
import type { LiveChat, ProposalItem } from './chat-model';
import { background } from './background/client';
import { chatC4Timeline } from './chat-c4-timeline';
import { notifyChatC4Decision } from './chat-c4-feedback';

/** A saved proposal is actionable immediately, including in an already open project chat. */
export function publishChatArchitecture(ctx: ChatEngine, live: LiveChat, item: ProposalItem) {
  const previous = live.timeline.state.items.find((value) => value.id === item.id);
  if (
    previous?.kind === 'proposal' &&
    previous.proposal.type === 'architecture' &&
    item.proposal.type === 'architecture' &&
    previous.proposal.packageId === item.proposal.packageId &&
    previous.state === item.state &&
    previous.result?.error === item.result?.error &&
    previous.proposal.contentRef === item.proposal.contentRef
  )
    return false;
  ctx.history.skaroEvent(live, {
    t: 'item.upsert',
    item: { ...item, turnId: previous?.turnId ?? live.timeline.state.turns.at(-1)?.id ?? '' },
  });
  ctx.history.flush(live);
  ctx.listChanged(live.projectId, live.chat.id);
  notifyChatC4Decision(ctx, live, previous?.kind === 'proposal' ? previous : undefined, item);
  return true;
}

/** Turn completion repairs lost publication without manufacturing a proposal or owner consent. */
export async function restoreChatArchitecture(ctx: ChatEngine, live: LiveChat) {
  if (!isAuditChat(ctx.deps.db, live.chat.id)) return;
  const records = await background(ctx.deps.dataDir, 'c4.list', live.projectId, live.chat.id);
  if (ctx.closing || ctx.live.get(live.chat.id) !== live) return;
  const present = new Set(live.timeline.state.items.map((item) => item.id));
  for (const record of records)
    if (
      record.scope.kind === 'project_chat' &&
      record.scope.chatId === live.chat.id &&
      (present.has(record.item.id) || ['pending', 'accepted'].includes(record.item.state))
    )
      publishChatArchitecture(ctx, live, record.item);
}

/** Canonical pending decisions are independent of history pages and cached timeline delivery. */
export async function projectChatArchitecture(
  ctx: ChatEngine,
  projectId: string,
  chatId: string,
  timeline: TimelineState,
): Promise<TimelineState> {
  if (!isAuditChat(ctx.deps.db, chatId)) return timeline;
  const records = await background(ctx.deps.dataDir, 'c4.list', projectId, chatId);
  return chatC4Timeline(projectId, chatId, timeline, records);
}
