import type { ProjectCheck } from '@skaro/core';
import type { IntegrationOperation } from './integration-model';
import type { IntegrationCheck } from '@skaro/mcp-server';

const shell = (check: ProjectCheck) => check.shell ?? 'system';
const key = (check: ProjectCheck) => JSON.stringify([check.run, shell(check)]);

/**
 * Saved checks of accepted results. Preparing dependencies re-runs them as regression evidence of
 * both inputs; a merge (D-45) runs only the project checks and what its agent adds for the resolution.
 */
export function inheritedChecks(op: IntegrationOperation): ProjectCheck[] {
  if (op.purpose === 'publication') return [];
  return [...op.results, ...(op.baseResults ?? [])].flatMap((result) => result.verification ?? []);
}

/** Machine checks cover mandatory project rules and accepted behavior from both inputs. */
export function integrationChecks(
  op: IntegrationOperation,
  derived: ProjectCheck[] = [],
): ProjectCheck[] {
  const checks = [...op.checks, ...inheritedChecks(op), ...(op.verificationPlan ?? []), ...derived];
  for (const replacement of op.checkReplacements ?? [])
    for (let i = 0; i < checks.length; i++)
      if (checks[i]!.run === replacement.replaces) checks[i] = replacement.check;
  return [...new Map(checks.map((check) => [key(check), check])).values()];
}

/** Replace an exact command without editing accepted inputs or dropping unrelated checks. */
export function reviseIntegrationChecks(op: IntegrationOperation, submitted: IntegrationCheck[]) {
  const replacements = [...(op.checkReplacements ?? [])];
  const additional: ProjectCheck[] = [];
  for (const { replaces, ...check } of submitted) {
    const current = integrationChecks({ ...op, checkReplacements: replacements }, additional);
    const saved = current.filter((item) => item.run === (replaces ?? check.run));
    if (replaces) {
      // A replacement covers the command under every shell and every name it was saved with.
      if (!saved.length)
        throw new Error(`Cannot replace an unknown verification command: ${replaces}`);
      if (!saved.some((item) => item.name === check.name))
        throw new Error(
          `Replacement must preserve the check name: ${[...new Set(saved.map((item) => item.name))].join(' or ')}`,
        );
      replacements.push({ replaces, check });
    } else if (
      saved.length &&
      saved.every((item) => item.name === check.name) &&
      saved.some((item) => shell(item) !== shell(check))
    ) {
      // The same command stays one check: a stated shell corrects it, an omitted one keeps it.
      if (check.shell) replacements.push({ replaces: check.run, check });
    } else additional.push(check);
  }
  return {
    plan: integrationChecks({ ...op, checkReplacements: replacements }, additional),
    replacements,
  };
}
