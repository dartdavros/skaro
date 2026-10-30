import type { ProjectCheck } from '@skaro/core';
import { MERGE_CHECKS, type IntegrationOperation } from './integration-model';

const key = (check: ProjectCheck) => JSON.stringify([check.run, check.shell ?? 'system']);

/**
 * A merge candidate saved before its plan followed D-45 also lists the saved checks of every
 * accepted result touching its paths, often repaired by its agent. Drop them once, keeping the
 * project checks and the checks its agent wrote for the resolution, and let Skaro verify the
 * retained candidate with them: the dropped checks were the blocker, not the resolution.
 */
export function dropInheritedMergeChecks(op: IntegrationOperation): boolean {
  if (op.purpose !== 'publication' || op.mergeChecks === MERGE_CHECKS) return false;
  op.mergeChecks = MERGE_CHECKS;
  const project = new Set(op.checks.map(key));
  const saved = [...op.results, ...(op.baseResults ?? [])]
    .flatMap((result) => result.verification ?? [])
    .filter((check) => !project.has(key(check)));
  // A repair keeps the name of the check it replaces (reviseIntegrationChecks), so the name
  // identifies a repaired inherited check even after an earlier migration lost the repair chain.
  const names = new Set(saved.map((check) => check.name));
  const dropped = new Set(saved.map((check) => check.run));
  const replacements = op.checkReplacements ?? [];
  for (let grown = true; grown;) {
    grown = false;
    for (const replacement of replacements)
      if (
        (dropped.has(replacement.replaces) || names.has(replacement.check.name)) &&
        !dropped.has(replacement.check.run)
      ) {
        dropped.add(replacement.check.run);
        grown = true;
      }
  }
  const plan = op.verificationPlan ?? [];
  const kept = plan.filter((check) => !dropped.has(check.run) && !names.has(check.name));
  if (kept.length === plan.length) return false;
  op.verificationPlan = kept;
  op.checkReplacements = replacements.filter(
    (replacement) => !dropped.has(replacement.replaces) && !dropped.has(replacement.check.run),
  );
  if (!['resolving', 'verifying', 'waiting', 'paused', 'failed'].includes(op.state)) return true;
  op.verification = undefined;
  op.error = undefined;
  op.attempts = 0;
  // Skaro verifies the retained resolution itself; a failure returns it to its agent with the cause.
  op.state = kept.length || op.checks.length ? 'verifying' : 'resolving';
  op.needsVerification = op.state === 'resolving';
  return true;
}
