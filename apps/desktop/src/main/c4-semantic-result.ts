import type { C4ImpactObservation } from './c4-impact-observation';
import { memoryVersion } from './project-memory-sources';

export interface C4SemanticVerdict {
  version: 1;
  fingerprint: string;
  implementation: 'aligned' | 'conflicting' | 'unknown';
  category: 'aligned' | 'optional' | 'decision' | 'contradiction' | 'insufficient-evidence';
  summary: string;
  realized: string[];
  evidence: { path: string; hash: string | null; detail: string }[];
  conflicts: { requirement: string; source: string; detail: string }[];
}
/** A separately started reviewer supplies semantics; the host owns scope, hashes and permissions. */
export function parseC4SemanticVerdict(
  text: string,
  fingerprint: string,
  observed: C4ImpactObservation,
): C4SemanticVerdict {
  const value = JSON.parse(
    text.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1'),
  ) as C4SemanticVerdict;
  const detail = (v: unknown) => typeof v === 'string' && !!v.trim() && v.length <= 16000;
  const sources = new Map(observed.files.map((f) => [f.path, f.hash]));
  const ids = new Set([...observed.scope.elements, ...observed.scope.relationships]);
  if (
    value?.version !== 1 ||
    value.fingerprint !== fingerprint ||
    !['aligned', 'conflicting', 'unknown'].includes(value.implementation) ||
    !['aligned', 'optional', 'decision', 'contradiction', 'insufficient-evidence'].includes(
      value.category,
    ) ||
    !detail(value.summary) ||
    !Array.isArray(value.realized) ||
    new Set(value.realized).size !== value.realized.length ||
    value.realized.some((id) => !ids.has(id)) ||
    !Array.isArray(value.evidence) ||
    value.evidence.length > 10000 ||
    value.evidence.some(
      (e) => !sources.has(e.path) || sources.get(e.path) !== e.hash || !detail(e.detail),
    ) ||
    new Set(value.evidence.map((e) => e.path)).size !== value.evidence.length ||
    !Array.isArray(value.conflicts) ||
    value.conflicts.some(
      (c) =>
        !observed.scope.requirements.includes(c.requirement) ||
        !sources.has(c.source) ||
        !detail(c.detail),
    )
  )
    throw new Error('Independent C4 review returned invalid or foreign evidence');
  if (
    value.implementation === 'aligned' &&
    (value.conflicts.length ||
      observed.scope.files.some((p) => !value.evidence.some((e) => e.path === p)) ||
      !value.evidence.length)
  )
    throw new Error('Aligned C4 review must cover actual changed sources and contain no conflicts');
  if (value.category === 'contradiction' && !value.conflicts.length)
    throw new Error('C4 contradiction needs requirement/source evidence');
  if (['aligned', 'optional'].includes(value.category) && value.implementation !== 'aligned')
    throw new Error('Nonblocking C4 classification requires aligned implementation');
  return structuredClone(value);
}
/** Stable across code commit and unrelated model revisions; the observed contents remain exact. */
export function c4SemanticFingerprint(observation: C4ImpactObservation, contextHash: string) {
  return memoryVersion({
    project: observation.impact.projectId,
    task: observation.impact.taskId,
    run: observation.impact.runId,
    base: observation.impact.baseHead,
    scope: observation.scope,
    files: observation.files,
    resource: observation.resource,
    authority: observation.inputs.authority,
    dependencies: observation.inputs.dependencies,
    checks: observation.inputs.checks,
    workflow: observation.inputs.workflow,
    environment: observation.inputs.environment,
    contextHash,
  });
}
