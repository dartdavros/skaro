import type { RuntimeJournal } from '../journal.ts';
import { publicHistoryRecord } from './history-view.ts';

/** Immutable public evidence by record hash; closed native state is excluded. */
export function contextHistoryPage(
  journal: RuntimeJournal,
  input: {
    sequence: number;
    hash: string;
    cursor: number;
    limit: number;
  },
) {
  const record = journal.records[input.sequence - 1];
  if (!Number.isSafeInteger(input.sequence) || !record || record.hash !== input.hash)
    throw new Error('History reference does not match the primary journal');
  if (
    !Number.isSafeInteger(input.cursor) ||
    input.cursor < 0 ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 16_384
  )
    throw new Error('Invalid history page cursor');
  const text = JSON.stringify(publicHistoryRecord(record));
  if (input.cursor > text.length) throw new Error('History cursor is beyond the record');
  let end = Math.min(text.length, input.cursor + input.limit);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? '')) end--;
  if (
    input.cursor &&
    /[\uDC00-\uDFFF]/.test(text[input.cursor] ?? '') &&
    /[\uD800-\uDBFF]/.test(text[input.cursor - 1] ?? '')
  )
    throw new Error('History cursor splits a Unicode character');
  if (end === input.cursor && end < text.length)
    throw new Error('History limit splits a Unicode character');
  return {
    sequence: record.sequence,
    hash: record.hash,
    text: text.slice(input.cursor, end),
    nextCursor: end < text.length ? end : null,
  };
}
