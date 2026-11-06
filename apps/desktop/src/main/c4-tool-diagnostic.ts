import { C4ValidationError, type AppDb, type C4Diagnostic } from '@skaro/core';
import type { SkaroScope, ToolResult } from '@skaro/mcp-server';

export const c4DiagnosticKey = (runId: string) => `c4.diagnostic.${runId}`;

export function recordC4Diagnostic(
  db: AppDb,
  scope: SkaroScope,
  diagnostic: C4Diagnostic | null,
): void {
  if (scope.kind === 'task' && scope.runId) db.setSetting(c4DiagnosticKey(scope.runId), diagnostic);
}

/** Only a typed deterministic rejection is classified as a data problem. */
export function c4ToolFailure(error: unknown): ToolResult {
  if (!(error instanceof C4ValidationError)) throw error;
  const diagnostic = error.diagnostic;
  return { isError: true, structuredContent: { diagnostic }, text: JSON.stringify({ diagnostic }) };
}
