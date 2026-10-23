import type { ProjectCheck } from '@skaro/core';
import type { IntegrationOperation } from './integration-model';

const key = (check: ProjectCheck) => JSON.stringify([check.run, check.shell ?? 'system']);

/**
 * A merge candidate saved before its plan followed D-45 also lists the saved checks of every
 * accepted result touching its paths. Drop them once, with their replacements, keeping the project
 * checks and the checks its agent added. An agent may have listed an inherited command for its own
 * resolution too, so the retained candidate returns to its agent to submit those checks again.
 */
export function dropInheritedMergeChecks(op: IntegrationOperation): boolean {
  if (op.purpose !== 'publication' || op.mergeChecks) return false;
  op.mergeChecks = true;
  const project = new Set(op.checks.map(key));
  const inherited = new Set(
    [...op.results, ...(op.baseResults ?? [])]
      .flatMap((result) => result.verification ?? [])
      .filter((check) => !project.has(key(check)))
      .map((check) => check.run),
  );
  const replacements = op.checkReplacements ?? [];
  const dropped = new Set([
    ...inherited,
    ...replacements
      .filter((replacement) => inherited.has(replacement.replaces))
      .map((replacement) => replacement.check.run),
  ]);
  const plan = op.verificationPlan ?? [];
  const kept = plan.filter((check) => !dropped.has(check.run));
  if (kept.length === plan.length) return false;
  op.verificationPlan = kept;
  op.checkReplacements = replacements.filter((replacement) => !inherited.has(replacement.replaces));
  if (!['resolving', 'verifying', 'waiting', 'failed'].includes(op.state)) return true;
  // The removed checks were the blocker, not the resolution: its agent continues without waiting.
  op.verification = undefined;
  op.error = undefined;
  op.state = 'resolving';
  op.needsVerification = true;
  op.attempts = 0;
  return true;
}
