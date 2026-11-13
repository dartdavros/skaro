import { createHash } from 'node:crypto';
import type { C4Impact } from './impact-contract.ts';

const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 8192;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const path = (v: unknown) =>
  text(v) &&
  !/^(?:[a-z]:|\/|\\)/i.test(v) &&
  !v.split(/[\\/]/).some((part) => part === '..' || part === '.' || !part);
const refs = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 10000 && v.every(text) && new Set(v).size === v.length;

export function validateC4Impact(input: C4Impact): void {
  if (!input || input.version !== 1) throw new Error('Unsupported C4 impact version');
  if (
    ![input.projectId, input.taskId, input.runId, input.checkout].every(text) ||
    !/^(?:[a-z]:[\\/]|\/)/i.test(input.checkout) ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.baseHead) ||
    !hash(input.changeHash) ||
    !hash(input.scopeHash) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    ![input.requirements, input.elements, input.relationships].every(refs)
  )
    throw new Error('Invalid C4 impact identity or scope');
  if (
    !Array.isArray(input.sources) ||
    input.sources.length > 10000 ||
    !input.sources.every((s) => s && path(s.path) && hash(s.hash)) ||
    new Set(input.sources.map((s) => s.path)).size !== input.sources.length ||
    !Array.isArray(input.checks) ||
    input.checks.length > 10000 ||
    !input.checks.every(
      (c) =>
        c &&
        text(c.id) &&
        hash(c.fingerprint) &&
        ['passed', 'failed', 'unknown'].includes(c.outcome),
    ) ||
    new Set(input.checks.map((c) => c.id)).size !== input.checks.length ||
    !Array.isArray(input.discrepancies) ||
    input.discrepancies.length > 10000 ||
    !input.discrepancies.every(
      (d) =>
        d &&
        text(d.detail) &&
        input.sources.some((s) => s.path === d.source) &&
        input.requirements.includes(d.requirement),
    )
  )
    throw new Error('Invalid C4 impact evidence');
}

/** Field order is fixed, set-like scopes sorted; no worker prose becomes authority. */
export function c4ImpactFingerprint(input: C4Impact): string {
  validateC4Impact(input);
  const canonical = [
    input.version,
    input.projectId,
    input.taskId,
    input.runId,
    input.checkout,
    input.baseHead,
    input.changeHash,
    input.scopeHash,
    input.expectedRevision,
    [...input.requirements].sort(),
    [...input.elements].sort(),
    [...input.relationships].sort(),
    input.sources.map((s) => JSON.stringify([s.path, s.hash])).sort(),
    input.checks.map((c) => JSON.stringify([c.id, c.fingerprint, c.outcome])).sort(),
    input.discrepancies.map((d) => JSON.stringify([d.source, d.requirement, d.detail])).sort(),
  ];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
