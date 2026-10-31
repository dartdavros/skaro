import type { RuntimeJournal } from '../journal.ts';
import type { ContextCheckpoint, ContextSnapshot } from './model.ts';
import { contextHash } from './sources.ts';
import { workingNotes } from './working-notes.ts';

const decisions = new Set(['compact', 'refreshContext'].map((type) => contextHash({ type })));

export function latestContext(journal: RuntimeJournal): ContextCheckpoint | undefined {
  for (let index = journal.records.length - 1; index >= 0; index--) {
    const value = journal.records[index]!.result.value as Partial<ContextCheckpoint> | undefined;
    if (
      decisions.has(journal.records[index]!.requestHash ?? '') &&
      value?.kind === 'builtin-context'
    ) {
      if (value.schema !== 1 || !value.snapshot || value.snapshot.schema !== 1)
        throw new Error('Unsupported context checkpoint');
      return structuredClone(value) as ContextCheckpoint;
    }
  }
  return undefined;
}
export function contextCheckpoint(
  journal: RuntimeJournal,
  snapshot: ContextSnapshot,
  compact: boolean,
): ContextCheckpoint {
  const previous = latestContext(journal);
  const head = journal.records.at(-1)!;
  const categories = (record: RuntimeJournal['records'][number]): string[] => {
    const result: string[] = [];
    for (const fact of record.facts)
      if (
        ['input', 'interaction', 'answer', 'effect-result', 'effect-unknown', 'rewind'].includes(
          fact.type,
        )
      )
        result.push(fact.type);
    if (record.id.startsWith('model-') || record.id.startsWith('native-'))
      result.push('model-history');
    return result;
  };
  return {
    kind: 'builtin-context',
    schema: 1,
    epoch: (previous?.epoch ?? 0) + (compact ? 1 : 0),
    snapshot,
    history: { throughSequence: head.sequence, headHash: head.hash },
    workingNotes: workingNotes(journal),
    // Compact retains a bounded index plus an exact journal head; older pages remain readable.
    historyRefs: journal.records
      .flatMap((record) => {
        const category = categories(record).join(',');
        return category
          ? [{ sequence: record.sequence, id: record.id, hash: record.hash, category }]
          : [];
      })
      .slice(-64),
  };
}
