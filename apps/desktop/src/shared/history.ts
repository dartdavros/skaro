import type {
  FeedBlock,
  FeedRow,
  TimelineState,
  actionGroupState,
  actionGroupSummary,
  actionGroupDiffStats,
} from '@skaro/timeline';
// Rebuild derived rows that previously exposed the second leading service note.
export const HISTORY_VERSION = 5;

/** A stable read projection; pages may be evicted without losing the conversation. */
export interface HistorySource {
  owner: string;
  key: string;
  revision: number;
  /** Rows can stay unchanged while the ordered control/header revision advances. */
  contentRevision?: number;
  count: number;
  itemCount?: number;
  changeCount?: number;
  changeRevision?: number;
}
export const historyContentRevision = (source: HistorySource): number =>
  source.contentRevision ?? source.revision;
export type HistoryRow = FeedRow & {
  history?: HistorySource;
  hasAgentReply?: boolean;
};
export type HistoryBlock = FeedBlock & {
  history?: HistorySource;
  presentation?: {
    reply?: string;
    replyId?: string;
    ended?: boolean;
    last?: boolean;
    parts?: ReturnType<typeof actionGroupSummary>;
    state?: ReturnType<typeof actionGroupState>;
    diff?: ReturnType<typeof actionGroupDiffStats>;
  };
};
export interface HistoryPage {
  source: HistorySource;
  start: number;
  blocks: HistoryBlock[];
}
export interface HistoryView {
  page?: HistoryPage;
  source: HistorySource;
  timeline: TimelineState;
}
export interface HistoryOrigin {
  id: string;
  seq: number;
  live: boolean;
  timeline: TimelineState;
}
export interface HistoryMethods {
  'history.changes': (
    source: HistorySource,
    start: number,
  ) => import('./proposal-changes').ProposalChange[];
  'history.page': (source: HistorySource, start: number, limit: number) => HistoryPage;
  'history.find': (source: HistorySource, id: string) => number;
  'history.copy': (source: HistorySource, pending?: HistoryPending[]) => void;
}
export interface HistoryPending {
  id: string;
  text: string;
}
export interface HistoryEvents {
  'history.changed': { owner: string; view?: HistoryView; error?: string };
}
