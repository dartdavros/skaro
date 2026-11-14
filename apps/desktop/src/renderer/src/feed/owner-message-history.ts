import { withoutSkaroNote, type Item, type TimelineState } from '@skaro/timeline';
import {
  historyContentRevision,
  type HistoryPage,
  type HistorySource,
} from '../../../shared/history';
import type { MessageInput } from '../../../shared/ipc';

interface HistoryView {
  history?: HistorySource;
  historyPage?: HistoryPage;
}

/** A header acknowledges delivery; only a loaded row can replace the local echo. */
export function visibleOwnerMessages(
  timeline: TimelineState | undefined,
  view?: HistoryView,
): Item[] {
  if (!view?.history) return timeline?.items ?? [];
  const { history, historyPage: page } = view;
  if (
    !page ||
    page.source.owner !== history.owner ||
    page.source.key !== history.key ||
    page.source.count !== history.count ||
    historyContentRevision(page.source) !== historyContentRevision(history)
  )
    return [];
  return page.blocks.flatMap((block) =>
    block.type === 'row' && block.row.type === 'user' && !block.row.hidden
      ? [timeline?.items.find((item) => item.id === block.row.id) ?? block.row.item]
      : [],
  );
}

export function matchesOwnerMessage(item: Item, input: MessageInput, at: number): boolean {
  if (item.kind !== 'message' || item.role !== 'user' || item.parentId) return false;
  if (item.native.ref === input.commandId) return true;
  const commands = [...item.text.matchAll(/command_id: ([^\r\n]+)/g)];
  // Repeating the same text must not acknowledge a different recent command.
  if (commands.length) return commands.some((match) => match[1] === input.commandId);
  return (
    item.native.type !== 'owner_command' &&
    item.startedAt >= at - 2000 &&
    withoutSkaroNote(item.text) === input.text
  );
}
