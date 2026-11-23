import type { AppDb } from '@skaro/core';
import type { ToolResult } from '@skaro/mcp-server';
import type { LiveChat, ProposalItem } from './chat-model';
import { currentTurn } from './chat-settings-helpers';

interface PlanningIntent {
  turn: string;
  proposals: string[];
  decision?: string;
  attempts: number;
  stopped?: boolean;
}

const key = (live: Pick<LiveChat, 'chat'>) => `chat.planning-intent.${live.chat.id}`;
const proposals = (live: LiveChat) =>
  live.timeline.state.items.filter((item): item is ProposalItem => item.kind === 'proposal');

export function planningIntent(db: AppDb, live: Pick<LiveChat, 'chat'>) {
  const intent = db.getSetting<PlanningIntent | null>(key(live), null);
  return intent?.stopped ? null : intent;
}

export function stopPlanningIntent(db: AppDb, live: LiveChat) {
  const intent = planningIntent(db, live);
  if (intent) db.setSetting(key(live), { ...intent, stopped: true });
}

export function beginPlanningIntent(db: AppDb, live: LiveChat, decision?: string): ToolResult {
  const cards = proposals(live);
  const waiting = cards.find((item) => item.id === decision);
  if (decision && (!waiting || !['architecture', 'plan'].includes(waiting.proposal.type)))
    return { text: 'The prerequisite decision must belong to this chat.', isError: true };
  const turn = currentTurn(live);
  const previous = planningIntent(db, live);
  const intent = previous
    ? previous
    : { turn, proposals: cards.map((item) => item.id), attempts: 0 };
  db.setSetting(key(live), { ...intent, ...(decision && { decision }) });
  return { text: 'Task planning is registered. Propose the tasks when prerequisites are applied.' };
}

export function nextPlanningIntent(
  db: AppDb,
  live: LiveChat,
): 'continue' | 'exhausted' | undefined {
  const intent = planningIntent(db, live);
  if (!intent) return;
  const cards = proposals(live);
  if (
    cards.some(
      (item) =>
        !intent.proposals.includes(item.id) &&
        item.proposal.type === 'plan' &&
        item.proposal.tasks.length,
    )
  ) {
    db.setSetting(key(live), null);
    return;
  }
  const waiting = cards.filter(
    (item) =>
      item.id === intent.decision ||
      (item.turnId === intent.turn &&
        !intent.proposals.includes(item.id) &&
        (item.proposal.type === 'architecture' ||
          (item.proposal.type === 'plan' && !item.proposal.tasks.length))),
  );
  if (waiting.some((item) => ['rejected', 'reverted', 'superseded'].includes(item.state))) {
    stopPlanningIntent(db, live);
    return;
  }
  if ((intent.decision && !waiting.length) || waiting.some((item) => item.state !== 'applied'))
    return;
  if (intent.attempts >= 2) {
    stopPlanningIntent(db, live);
    return 'exhausted';
  }
  db.setSetting(key(live), { ...intent, attempts: intent.attempts + 1 });
  return 'continue';
}
