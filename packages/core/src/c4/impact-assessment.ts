import type { C4Package } from './model.ts';
import type { C4Impact, C4ImpactOperation } from './impact-contract.ts';
import { c4ImpactFingerprint } from './impact-validation.ts';
import { c4Hash } from './documents.ts';
import { c4PackageModels, reviewC4Package } from './package-review.ts';

/** Host-observed facts, never copied from an untrusted worker report to grant permission. */
export interface C4ImpactFacts {
  observed: C4Impact;
  /** Host verification of accepted requirements/code semantics, separate from schema validity. */
  semanticEvidence: 'verified' | 'unknown';
  renames: { before: string; after: string; beforeHash: string; afterHash: string }[];
  dependencies: { taskId: string; requirements: string[] }[];
}
export interface C4ImpactAssessment {
  category: 'technical' | 'decision' | 'optional' | 'contradiction' | 'insufficient-evidence';
  reason: string;
  waiting: { taskId: string; requirements: string[]; reason: string }[];
  /** Classification is not execution authorization; C4-2 supplies the policy/transaction. */
  mayApply: false;
  operation?: C4ImpactOperation;
}

export function assessC4Impact(
  report: C4Impact,
  facts: C4ImpactFacts,
  pkg?: C4Package,
): C4ImpactAssessment {
  const fingerprint = c4ImpactFingerprint(report);
  const result = (
    category: C4ImpactAssessment['category'],
    reason: string,
    requirements = report.requirements,
  ): C4ImpactAssessment => ({
    category,
    reason,
    mayApply: false,
    waiting:
      category === 'optional' || category === 'technical'
        ? []
        : facts.dependencies.flatMap((d) => {
            const affected = d.requirements.filter((r) => requirements.includes(r));
            return affected.length ? [{ taskId: d.taskId, requirements: affected, reason }] : [];
          }),
  });
  if (fingerprint !== c4ImpactFingerprint(facts.observed))
    return result('insufficient-evidence', 'stale_or_foreign_evidence');
  if (
    !report.sources.length ||
    !report.checks.length ||
    report.checks.some((c) => c.outcome !== 'passed') ||
    facts.semanticEvidence !== 'verified'
  )
    return result('insufficient-evidence', 'verification_required');
  if (report.discrepancies.length)
    return result(
      'contradiction',
      'accepted_requirement_conflict',
      report.discrepancies.map((d) => d.requirement),
    );
  if (!pkg)
    return report.requirements.length
      ? result('insufficient-evidence', 'required_scope_has_no_operation')
      : result('optional', 'no_required_change');
  if (
    pkg.baseRevision !== report.expectedRevision ||
    (pkg.task && (pkg.task.id !== report.taskId || pkg.task.runId !== report.runId))
  )
    return result('insufficient-evidence', 'package_scope_or_version_changed');
  const review = reviewC4Package(pkg);
  const models = c4PackageModels(pkg);
  if (
    (models.before?.revision ?? 0) !== pkg.baseRevision ||
    review.revision !== pkg.baseRevision + 1
  )
    return result('insufficient-evidence', 'invalid_candidate_revision');
  const codeOnly = review.model.every((change) => {
    if (
      change.group !== 'elements' ||
      change.operation !== 'update' ||
      !report.elements.includes(change.id) ||
      change.fields.some((field) => field !== 'code')
    )
      return false;
    // The package contains the actual before/after paths; proof must match both ends.
    const before = models.before!.elements.find((e) => e.id === change.id)!.code;
    const after = models.after.elements.find((e) => e.id === change.id)!.code;
    const removed = before.filter((p) => !after.includes(p));
    const added = after.filter((p) => !before.includes(p));
    return (
      removed.length > 0 &&
      removed.length === added.length &&
      removed.every((from) =>
        facts.renames.some(
          (r) =>
            r.before === from &&
            added.includes(r.after) &&
            /^[a-f0-9]{64}$/.test(r.beforeHash) &&
            r.beforeHash === r.afterHash &&
            report.sources.some((s) => s.path === r.after && s.hash === r.afterHash),
        ),
      ) &&
      added.every((to) =>
        facts.renames.some(
          (r) =>
            r.after === to &&
            removed.includes(r.before) &&
            /^[a-f0-9]{64}$/.test(r.beforeHash) &&
            r.beforeHash === r.afterHash &&
            report.sources.some((s) => s.path === r.after && s.hash === r.afterHash),
        ),
      )
    );
  });
  const assessment =
    review.documents.length || !codeOnly
      ? result('decision', 'accepted_semantics_changed')
      : result('technical', 'verified_projection_or_code_binding');
  const packageFingerprint = c4Hash(JSON.stringify(pkg));
  return {
    ...assessment,
    operation: {
      version: 1,
      projectId: report.projectId,
      runId: report.runId,
      taskId: report.taskId,
      idempotencyKey: c4Hash(
        JSON.stringify([report.projectId, report.runId, fingerprint, packageFingerprint]),
      ),
      expectedRevision: report.expectedRevision,
      packageFingerprint,
      impactFingerprint: fingerprint,
      scopeHash: report.scopeHash,
      changes: review.model.map(({ group, id, operation, fields }) => ({
        group,
        id,
        operation,
        fields,
      })),
      review: {
        elements: [...report.elements],
        relationships: [...report.relationships],
        requirements: [...report.requirements],
      },
      permission: { state: 'pending', protocol: 'impact-v1' },
    },
  };
}
