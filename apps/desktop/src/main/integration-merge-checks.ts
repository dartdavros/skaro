import type { ProjectCheck } from '@skaro/core';
import { MERGE_CHECKS, type IntegrationOperation } from './integration-model';

const key = (check: ProjectCheck) => JSON.stringify([check.run, check.shell ?? 'system']);

/**
 * A merge candidate saved before its plan followed D-45 also lists the saved checks of every
 * accepted result touching its paths. Drop them once, with their replacements, keeping the project
 * checks and the checks its agent added. An agent may have listed an inherited command for its own
 * resolution too, so the retained candidate returns to its agent to submit those checks again.
 */
export function dropInheritedMergeChecks(op: IntegrationOperation): boolean {
  if (op.purpose !== 'publication' || op.mergeChecks === MERGE_CHECKS) return false;
  op.mergeChecks = MERGE_CHECKS;
  const project = new Set(op.checks.map(key));
  const inherited = new Set(
    [...op.results, ...(op.baseResults ?? [])]
      .flatMap((result) => result.verification ?? [])
      .filter((check) => !project.has(key(check)))
      .map((check) => check.run),
  );
  const replacements = op.checkReplacements ?? [];
  // A repaired inherited check may be repaired again: its whole replacement chain is inherited.
  const dropped = new Set(inherited);
  for (let grown = true; grown;) {
    grown = false;
    for (const replacement of replacements)
      if (dropped.has(replacement.replaces) && !dropped.has(replacement.check.run)) {
        dropped.add(replacement.check.run);
        grown = true;
      }
  }
  const plan = op.verificationPlan ?? [];
  const kept = plan.filter((check) => !dropped.has(check.run));
  if (kept.length === plan.length) return false;
  op.verificationPlan = kept;
  op.checkReplacements = replacements.filter((replacement) => !dropped.has(replacement.replaces));
  if (!['resolving', 'verifying', 'waiting', 'paused', 'failed'].includes(op.state)) return true;
  // The removed checks were the blocker, not the resolution: its agent continues without waiting.
  op.verification = undefined;
  op.error = undefined;
  op.state = 'resolving';
  op.needsVerification = true;
  op.attempts = 0;
  return true;
}
