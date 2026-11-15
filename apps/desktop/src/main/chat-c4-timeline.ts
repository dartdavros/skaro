import type { TimelineState } from '@skaro/timeline';
import type { C4ProposalRecord } from './c4-service';
import { canonicalC4Decisions } from './c4-decision-sources';

/** Keep every open package in its own project chat, even outside the loaded history page. */
export function chatC4Timeline(
  projectId: string,
  chatId: string,
  timeline: TimelineState,
  records: C4ProposalRecord[],
): TimelineState {
  const present = new Set(timeline.items.map((item) => item.id));
  const projected = canonicalC4Decisions(
    { projectId, kind: 'chat', id: chatId, title: '', epoch: '', timeline },
    records.filter((record) => record.scope.kind === 'project_chat'),
  ).timeline;
  return {
    ...projected,
    items: projected.items.filter(
      (item) =>
        present.has(item.id) ||
        (item.kind === 'proposal' && ['pending', 'accepted'].includes(item.state)),
    ),
  };
}
