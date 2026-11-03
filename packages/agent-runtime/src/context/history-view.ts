import type { JournalRecord } from '../model.ts';

/** Public evidence only. Closed reasoning/items/signatures never become generic cross-route data. */
export function publicHistoryRecord(record: JournalRecord): unknown {
  const model =
    (record.id.startsWith('model-') || record.id.startsWith('native-')) &&
    record.id.endsWith(':result');
  const facts = record.facts
    .filter((fact) => !['continuation', 'created'].includes(fact.type))
    .filter(
      (fact) =>
        !(
          fact.type === 'timeline' &&
          fact.event.t === 'item.upsert' &&
          ['reasoning', 'unknown'].includes(fact.event.item.kind)
        ),
    );
  const raw = record.result.value as
    | {
        message?: { content?: string | null; refusal?: string };
        output?: { type?: string; text?: string; content?: { type?: string; text?: string }[] }[];
        provenance?: unknown;
      }
    | undefined;
  const result = model
    ? {
        text:
          raw?.message?.content ??
          raw?.message?.refusal ??
          raw?.output
            ?.flatMap((item) =>
              item.type === 'text'
                ? [item.text ?? '']
                : item.type === 'message'
                  ? (item.content ?? [])
                      .filter((part) => part.type === 'output_text')
                      .map((part) => part.text ?? '')
                  : [],
            )
            .join('\n') ??
          '',
        provenance: raw?.provenance,
      }
    : record.result;
  return {
    view: 'public-history-v1',
    id: record.id,
    sequence: record.sequence,
    sourceHash: record.hash,
    timestamp: record.timestamp,
    facts,
    result,
  };
}
