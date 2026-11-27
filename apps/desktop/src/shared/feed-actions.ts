import { architecturePresentation, type Item } from '@skaro/timeline';

type ProposalItem = Extract<Item, { kind: 'proposal' }>;

/** Unresolved decisions stay visible, including durable operations awaiting a retry. */
export function isPendingProposal(item: Item): item is ProposalItem {
  return item.kind === 'proposal' && (item.state === 'pending' || item.state === 'accepted');
}

export type TaskC4WaitPolicy = (id: string, packageId: string) => boolean;

export function isBlockingTaskProposal(item: Item, blocksC4?: TaskC4WaitPolicy): boolean {
  return (
    isPendingProposal(item) &&
    (item.state === 'accepted' ||
      item.proposal?.type !== 'architecture' ||
      (blocksC4 ? blocksC4(item.id, item.proposal.packageId) : item.proposal.blocksTask !== false))
  );
}

/** Keep C4 package bodies out of the renderer's always-resident action area. */
export function pendingProposals(items: Item[]): ProposalItem[] {
  return items.filter(isPendingProposal).map((item) =>
    item.proposal.type === 'architecture'
      ? {
          ...item,
          proposal: architecturePresentation(item.proposal, item.proposal.contentRef ?? item.id),
        }
      : item,
  );
}
