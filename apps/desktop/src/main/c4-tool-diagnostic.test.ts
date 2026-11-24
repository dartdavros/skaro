import { AppDb, C4ValidationError, c4Issue } from '@skaro/core';
import type { SkaroScope } from '@skaro/mcp-server';
import { expect, it } from 'vitest';
import {
  beginC4ProposalDiagnostic,
  readC4Diagnostic,
  recordC4Diagnostic,
  settleSavedC4ProposalDiagnostic,
} from './c4-tool-diagnostic';

it('supersedes a rejected C4 proposal and retains independent review errors', () => {
  const db = AppDb.open(':memory:');
  const runId = 'run';
  const scope: SkaroScope = { kind: 'task', projectId: 'project', taskId: 'T-001', runId };
  const proposal = new C4ValidationError([c4Issue('Rejected proposal')]).diagnostic;
  const review = new C4ValidationError([c4Issue('Rejected review')], 'review').diagnostic;
  try {
    recordC4Diagnostic(db, scope, proposal);
    beginC4ProposalDiagnostic(db, scope, 4)(null);
    expect(readC4Diagnostic(db, runId, 4)).toBeUndefined();
    const older = beginC4ProposalDiagnostic(db, scope, 4);
    beginC4ProposalDiagnostic(db, scope, 4)(null);
    older(proposal);
    expect(readC4Diagnostic(db, runId, 4)).toBeUndefined();
    beginC4ProposalDiagnostic(db, scope, 4)(proposal);
    expect(readC4Diagnostic(db, runId, 4)).toEqual(proposal);
    expect(readC4Diagnostic(db, runId, 5)).toBeUndefined();
    expect(settleSavedC4ProposalDiagnostic(db, runId, 4, 0)).toBe(false);
    expect(settleSavedC4ProposalDiagnostic(db, runId, 4, Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(readC4Diagnostic(db, runId, 4)).toBeUndefined();
    recordC4Diagnostic(db, scope, review);
    beginC4ProposalDiagnostic(db, scope, 5)(null);
    expect(readC4Diagnostic(db, runId, 5)).toEqual(review);
  } finally {
    db.close();
  }
});
