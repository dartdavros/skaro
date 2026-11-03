import type { RuntimeState } from '../model.ts';
import type { RuntimeJournal } from '../journal.ts';

type ContextState = Pick<RuntimeState, 'effects' | 'interactions'>;
const models = new Set(['model:chat', 'model:openai.responses', 'model:anthropic.messages']);

/** A fresh owner input never replays a prior model POST or resolves its unknown billing. */
export function contextProjectionBlocked(state: ContextState, freshOwnerInput = false) {
  return (
    Object.keys(state.interactions).length > 0 ||
    Object.values(state.effects).some(
      (effect) =>
        effect.state !== 'completed' &&
        !(freshOwnerInput && effect.state === 'unknown' && models.has(effect.name)),
    )
  );
}

/** Unknown POSTs invalidate older conversations, not a later confirmed provider continuation. */
export function requiresFreshModelConversation(journal: Pick<RuntimeJournal, 'state' | 'records'>) {
  const unknown = new Set(
    Object.entries(journal.state.effects)
      .filter(([, effect]) => effect.state === 'unknown' && models.has(effect.name))
      .map(([id]) => id),
  );
  if (!unknown.size) return false;
  let continuation = 0,
    invalidated = 0;
  const observed = new Set<string>();
  for (const record of journal.records)
    for (const fact of record.facts) {
      if (fact.type === 'continuation') continuation = record.sequence;
      const ids =
        fact.type === 'effect-unknown'
          ? [fact.id]
          : fact.type === 'recovery'
            ? fact.unknownEffects
            : [];
      for (const id of ids)
        if (unknown.has(id)) {
          observed.add(id);
          invalidated = record.sequence;
        }
    }
  if (observed.size !== unknown.size)
    throw new Error('Unknown model outcome lacks its primary provenance');
  return invalidated >= continuation;
}

/** Operational gates retain unknown billing, but never mistake it for an unknown command result. */
export function unresolvedOperationalEffects(journal: Pick<RuntimeJournal, 'state' | 'records'>) {
  const confirmedLaterConversation = !requiresFreshModelConversation(journal);
  return Object.entries(journal.state.effects).filter(
    ([, effect]) =>
      effect.state !== 'completed' &&
      !(effect.state === 'unknown' && confirmedLaterConversation && models.has(effect.name)),
  );
}
