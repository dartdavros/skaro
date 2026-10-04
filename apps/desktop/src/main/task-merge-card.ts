import type { MergeCheck } from '@skaro/core';
import type { Interaction } from '@skaro/timeline';
export type MergeInteraction = Extract<Interaction, { kind: 'merge' }>;

export function mergeInteraction(
  id: string,
  from: string,
  to: string,
  check: MergeCheck,
): MergeInteraction {
  return {
    kind: 'merge',
    id,
    from,
    to,
    files: check.stats.files - check.skaroChanges.length,
    added: check.stats.added,
    removed: check.stats.removed,
    blockers: check.blockers,
    ...(check.localChanges?.length ? { localChanges: check.localChanges } : {}),
    baseAhead: check.baseAhead,
    skaroChanges: check.skaroChanges,
    conflicts: check.conflicts,
  };
}

/** What the agent learns from merge_task. */
export function mergeToolReply(card: MergeInteraction): string {
  const lines: string[] = [];
  if (!card.blockers.length) {
    lines.push(
      `Skaro showed the user a card to merge ${card.from} into ${card.to} ` +
        `(${card.files} files, +${card.added} −${card.removed}). The merge happens after the user ` +
        'confirms it. End your turn now; do not merge yourself.',
    );
  } else {
    lines.push(`The merge of ${card.from} into ${card.to} is blocked:`);
    for (const blocker of card.blockers) {
      if (blocker === 'dirty_base')
        lines.push(
          `- merging would overwrite local files: ${card.localChanges?.join(', ') ?? 'see the card'}; preserve those edits before merging;`,
        );
      if (blocker === 'not_on_base')
        lines.push(`- the main working copy is not on ${card.to} (the user must switch to it);`);
      if (blocker === 'no_changes') lines.push('- the task branch has no code changes;');
      if (blocker === 'conflicts')
        lines.push(`- merge conflicts in: ${card.conflicts.join(', ')};`);
    }
    lines.push('The user sees this in a card. Tell the user briefly and end your turn.');
  }
  if (card.baseAhead) {
    lines.push(`Note: ${card.to} has ${card.baseAhead} commits the task branch does not have.`);
  }
  if (card.skaroChanges.length) {
    lines.push(
      'Changes to .skaro/ in the branch will be dropped: .skaro/ is changed only by Skaro.',
    );
  }
  return lines.join('\n');
}
