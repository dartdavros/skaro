import type { FeedRow } from '@skaro/timeline';
export type UserMessageProps = { row: Extract<FeedRow, { type: 'user' }> };
