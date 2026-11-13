import type { Interaction } from '@skaro/timeline';
interface Draft {
  picked: Record<string, string[]>;
  custom: Record<string, string>;
  customOn: Record<string, boolean>;
}
const drafts = new Map<string, Draft>();
export function questionDraftKey(
  owner: string | undefined,
  interaction: Extract<Interaction, { kind: 'question' }>,
) {
  return owner ? JSON.stringify([owner, interaction]) : undefined;
}
export function readQuestionDraft(key?: string): Draft {
  return key
    ? structuredClone(drafts.get(key) ?? { picked: {}, custom: {}, customOn: {} })
    : { picked: {}, custom: {}, customOn: {} };
}
/** Session memory only, bounded and excluding every secret field. No draft becomes a reply or journal entry. */
export function saveQuestionDraft(
  key: string | undefined,
  interaction: Extract<Interaction, { kind: 'question' }>,
  draft: Draft,
) {
  if (!key) return;
  const safe = interaction.questions.filter((q) => !q.secret).map((q) => q.id);
  const select = <T>(values: Record<string, T>) =>
    Object.fromEntries(
      safe.filter((id) => values[id] !== undefined).map((id) => [id, values[id]!]),
    ) as Record<string, T>;
  drafts.set(
    key,
    structuredClone({
      picked: select(draft.picked),
      custom: select(draft.custom),
      customOn: select(draft.customOn),
    }),
  );
  while (drafts.size > 128) drafts.delete(drafts.keys().next().value!);
}
export const forgetQuestionDraft = (key?: string) => {
  if (key) drafts.delete(key);
};
