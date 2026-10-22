/** Feed presentation only. Immutable package bytes belong to the domain store. */
export interface ArchitectureProposal {
  type: 'architecture';
  packageId: string;
  title: string;
  summary: string;
  baseRevision: number;
  /** Legacy payloads only; new feed projections never carry package files. */
  files?: { path: string; before: string | null; after: string }[];
  task?: { id: string; runId: string };
  before?: string;
  after?: string;
  /** Full immutable package is loaded only by the viewer/domain, never with every feed snapshot. */
  contentRef?: string;
  preview?: {
    added: number;
    removed: number;
    lines: ({ gap: true } | { op: '+' | '-' | ' '; text: string })[];
  };
}

/** The feed cannot accidentally transport a model, document body or legacy preview. */
export function architecturePresentation(
  proposal: ArchitectureProposal,
  contentRef: string,
): ArchitectureProposal {
  const excerpt = (text: string, limit: number) =>
    text.length > limit ? text.slice(0, limit) + '…' : text;
  return {
    type: 'architecture',
    packageId: proposal.packageId,
    title: excerpt(proposal.title, 200),
    summary: excerpt(proposal.summary, 1200),
    baseRevision: proposal.baseRevision,
    contentRef,
    ...(proposal.task ? { task: proposal.task } : {}),
  };
}
