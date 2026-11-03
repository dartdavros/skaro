import type { RuntimeJournal } from '../journal.ts';
import { publicHistoryRecord } from './history-view.ts';

export interface WorkingNote {
  origin: 'model';
  source: { sequence: number; hash: string; id: string };
  text: string;
  truncated: boolean;
}
/** Exact bounded public output with provenance, never an inferred owner decision or native item. */
export function workingNotes(journal: RuntimeJournal): WorkingNote[] {
  const notes: WorkingNote[] = [];
  for (let index = journal.records.length - 1; index >= 0 && notes.length < 4; index--) {
    const record = journal.records[index]!;
    if (
      !(record.id.startsWith('model-') || record.id.startsWith('native-')) ||
      !record.id.endsWith(':result')
    )
      continue;
    const view = publicHistoryRecord(record) as { result?: { text?: string } };
    const text = view.result?.text;
    if (!text) continue;
    let end = Math.min(text.length, 2048);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? '')) end--;
    notes.push({
      origin: 'model',
      source: { sequence: record.sequence, hash: record.hash, id: record.id },
      text: text.slice(0, end),
      truncated: end < text.length,
    });
  }
  return notes.reverse();
}
