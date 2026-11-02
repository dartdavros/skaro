import type { RuntimeJournal } from '../journal.ts';
import { requiresFreshModelConversation } from '../context/effect-boundary.ts';

/** Old unknown billing is retained. Only a later confirmed provider conversation can supersede it. */
export function unresolvedVerificationEffects(journal: Pick<RuntimeJournal, 'state' | 'records'>) {
  const confirmedLaterConversation = !requiresFreshModelConversation(journal);
  return Object.entries(journal.state.effects).filter(
    ([, effect]) =>
      effect.state !== 'completed' &&
      !(
        effect.state === 'unknown' &&
        confirmedLaterConversation &&
        ['model:chat', 'model:openai.responses', 'model:anthropic.messages'].includes(effect.name)
      ),
  );
}
