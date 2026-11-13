import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { C4Package } from './model.ts';
import type { C4Impact } from './impact-contract.ts';
import { c4RunProtocol } from './impact-contract.ts';
import { c4ImpactFingerprint } from './impact-validation.ts';
import { assessC4Impact } from './impact-assessment.ts';
import { c4Hash } from './documents.ts';
import { reviewC4Package } from './package-review.ts';

// Explicit owner authorization required; never discover or traverse other projects.
const data = process.env.SKARO_C4_IMPACT_DATA;
const project = process.env.SKARO_C4_IMPACT_PROJECT;
it.skipIf(!data || !project)(
  'classifies saved packages without migrating or changing their bytes or decisions',
  () => {
    const db = new DatabaseSync(join(data!, 'workspace.db'), { readOnly: true });
    try {
      const read = () =>
        db.prepare('SELECT * FROM records WHERE project=? ORDER BY id').all(project!);
      const before = read();
      expect(before.length).toBeGreaterThan(0);
      let decisions = 0;
      for (const row of before) {
        const stored = JSON.parse(String(row.payload)) as C4Package;
        const content = (hash: string) =>
          String(db.prepare('SELECT text FROM content WHERE id=?').get(hash)!.text);
        const pkg: C4Package = {
          ...stored,
          files: stored.files.map((f) => ({
            ...f,
            before: f.before === null ? null : content(f.before),
            after: content(f.after),
          })),
        };
        const review = reviewC4Package(pkg);
        // Pure classification inputs derived from saved content. These are not a new code review.
        const report: C4Impact = {
          version: 1,
          projectId: project!,
          taskId: pkg.task?.id ?? pkg.id,
          runId: pkg.task?.runId ?? pkg.id,
          checkout: data!,
          baseHead: c4Hash(String(row.payload)),
          changeHash: review.fingerprint,
          scopeHash: c4Hash(JSON.stringify(review.model)),
          expectedRevision: pkg.baseRevision,
          requirements: [pkg.id],
          elements: review.model.filter((c) => c.group === 'elements').map((c) => c.id),
          relationships: review.model.filter((c) => c.group === 'relationships').map((c) => c.id),
          sources: pkg.files.map((f) => ({ path: f.path, hash: c4Hash(f.after) })),
          checks: [{ id: 'saved-bytes', fingerprint: review.fingerprint, outcome: 'passed' }],
          discrepancies: [],
        };
        const facts = {
          observed: report,
          semanticEvidence: 'unknown' as const,
          renames: [],
          dependencies: [{ taskId: report.taskId, requirements: report.requirements }],
        };
        const unverified = assessC4Impact(report, facts, pkg);
        expect(unverified.category).toBe('insufficient-evidence');
        expect(unverified.mayApply).toBe(false);
        // Exercise the classifier predicate, not a claim of host semantic verification.
        const assessed = assessC4Impact(report, { ...facts, semanticEvidence: 'verified' }, pkg);
        if (assessed.category === 'decision') decisions++;
        expect(assessed.mayApply).toBe(false);
        expect(assessed.operation?.permission.state).toBe('pending');
        if (row.id === before[0]!.id) {
          // In-memory projection of the real accepted snapshot, not a fixture project or write.
          const projection = {
            ...pkg,
            files: pkg.files.map((f) => ({
              ...f,
              before:
                f.path === 'c4/model.json'
                  ? JSON.stringify({ ...JSON.parse(f.after), revision: pkg.baseRevision })
                  : f.after,
            })),
          };
          const technical = assessC4Impact(
            report,
            { ...facts, semanticEvidence: 'verified' },
            projection,
          );
          expect(technical.category).toBe('technical');
          expect(technical.mayApply).toBe(false);
          expect(
            assessC4Impact(report, { ...facts, semanticEvidence: 'verified' }, projection).operation
              ?.idempotencyKey,
          ).toBe(technical.operation?.idempotencyKey);
          const optional = { ...report, requirements: [] };
          expect(
            assessC4Impact(optional, { ...facts, observed: optional, semanticEvidence: 'verified' })
              .category,
          ).toBe('optional');
        }
        expect(
          assessC4Impact({ ...report, expectedRevision: report.expectedRevision + 1 }, facts, pkg)
            .reason,
        ).toBe('stale_or_foreign_evidence');
        expect(c4RunProtocol(report.projectId, report.runId)).toBe('package-v1');
        expect(() =>
          c4RunProtocol(report.projectId, report.runId, {
            projectId: report.projectId,
            runId: report.runId + ':other',
            protocol: 'impact-v1',
          }),
        ).toThrow();
        expect(c4ImpactFingerprint({ ...report, sources: [...report.sources].reverse() })).toBe(
          c4ImpactFingerprint(report),
        );
        const conflict = {
          ...report,
          discrepancies: [
            {
              source: report.sources[0]!.path,
              requirement: pkg.id,
              detail: 'Predicate verification of a required conflict',
            },
          ],
        };
        expect(
          assessC4Impact(conflict, {
            ...facts,
            observed: conflict,
            semanticEvidence: 'verified',
          }).waiting.map((w) => w.taskId),
        ).toEqual([report.taskId]);
        expect(() =>
          c4ImpactFingerprint({
            ...report,
            sources: [{ path: '../escape', hash: review.fingerprint }],
          }),
        ).toThrow();
      }
      expect(decisions).toBeGreaterThan(0);
      expect(read()).toEqual(before);
    } finally {
      db.close();
    }
  },
  30_000,
);
