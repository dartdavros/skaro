import { C4ValidationError, type AppDb, type C4Diagnostic } from '@skaro/core';
import type { SkaroScope, ToolResult } from '@skaro/mcp-server';

const diagnosticKey = (runId: string) => `c4.diagnostic.${runId}`;
const proposalKey = (runId: string) => `c4.proposal-diagnostic.${runId}`;
type DiagnosticStore = Pick<AppDb, 'getSetting' | 'setSetting'>;
interface ProposalDiagnostic {
  revision: number;
  diagnostic: C4Diagnostic;
  rejectedAt: number;
}

const pendingProposals = new Map<string, symbol>();

/** A later proposal attempt owns its own diagnostic, even if an older attempt finishes last. */
export function beginC4ProposalDiagnostic(
  db: DiagnosticStore,
  scope: SkaroScope,
  revision: number,
) {
  const runId = scope.kind === 'task' ? scope.runId : undefined;
  if (!runId) return () => false;
  const attempt = Symbol();
  pendingProposals.set(runId, attempt);
  return (diagnostic?: C4Diagnostic | null): boolean => {
    if (pendingProposals.get(runId) !== attempt) return false;
    pendingProposals.delete(runId);
    if (diagnostic === undefined) return false;
    const before = db.getSetting<ProposalDiagnostic | null>(proposalKey(runId), null);
    if (before && before.revision > revision) return false;
    const legacy =
      db.getSetting<C4Diagnostic | null>(diagnosticKey(runId), null)?.stage === 'proposal';
    if (diagnostic || before)
      db.setSetting(
        proposalKey(runId),
        diagnostic ? { revision, diagnostic, rejectedAt: Date.now() } : null,
      );
    if (legacy) db.setSetting(diagnosticKey(runId), null);
    return !!(diagnostic || before || legacy);
  };
}

/** Recover the acknowledgement if Skaro exited after the package was durably prepared. */
export function settleSavedC4ProposalDiagnostic(
  db: DiagnosticStore,
  runId: string,
  revision: number,
  savedAt: number,
): boolean {
  const key = proposalKey(runId);
  const rejected = db.getSetting<ProposalDiagnostic | null>(key, null);
  if (!rejected || rejected.revision > revision || rejected.rejectedAt >= savedAt) return false;
  db.setSetting(key, null);
  return true;
}

export function readC4Diagnostic(
  db: Pick<AppDb, 'getSetting'>,
  runId: string,
  revision?: number,
): C4Diagnostic | undefined {
  const current = db.getSetting<C4Diagnostic | null>(diagnosticKey(runId), null);
  if (current) return current;
  const proposal = db.getSetting<ProposalDiagnostic | null>(proposalKey(runId), null);
  if (proposal && (revision === undefined || proposal.revision === revision))
    return proposal.diagnostic;
  return undefined;
}

export function recordC4Diagnostic(
  db: AppDb,
  scope: SkaroScope,
  diagnostic: C4Diagnostic | null,
): void {
  if (scope.kind !== 'task' || !scope.runId) return;
  db.setSetting(diagnosticKey(scope.runId), diagnostic);
  if (diagnostic === null) {
    db.setSetting(proposalKey(scope.runId), null);
  }
}

/** Only a typed deterministic rejection is classified as a data problem. */
export function c4ToolFailure(error: unknown): ToolResult {
  if (!(error instanceof C4ValidationError)) throw error;
  const diagnostic = error.diagnostic;
  return { isError: true, structuredContent: { diagnostic }, text: JSON.stringify({ diagnostic }) };
}
