import type { HistoryBlock, HistoryPage, HistorySource } from '../../shared/history';
import type { PayloadStore } from './payload-store';
import { architecturePresentation } from '@skaro/timeline';

/** Nested ranges inherit the same content version without rewriting stored rows. */
export function readHistoryPage(
  store: PayloadStore,
  source: HistorySource,
  start: number,
  limit: number,
): HistoryPage {
  start = Math.max(0, Math.min(source.count, Math.floor(start)));
  limit = Math.max(1, Math.min(32, Math.floor(limit)));
  const blocks = store.db
    .prepare(
      `SELECT value FROM feed_blocks
    WHERE owner=? AND key=? AND position>=? AND position<? ORDER BY position`,
    )
    .all(source.owner, source.key, start, start + limit)
    .map((row) => {
      const block = JSON.parse(String(row['value'])) as HistoryBlock;
      if (
        block.type === 'row' &&
        block.row.type === 'proposal' &&
        block.row.item.proposal.type === 'architecture'
      ) {
        const p = block.row.item.proposal;
        block.row.item.proposal = architecturePresentation(p, p.contentRef ?? block.row.item.id);
      }
      const inherit = (nested: HistorySource) =>
        Object.assign(nested, {
          revision: source.revision,
          contentRevision: source.contentRevision,
        });
      if (block.history) inherit(block.history);
      if (block.type === 'row' && 'history' in block.row) {
        const nested = block.row as import('../../shared/history').HistoryRow;
        if (nested.history) inherit(nested.history);
      }
      return block;
    });
  return { source, start, blocks };
}
