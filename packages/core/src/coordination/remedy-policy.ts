import { incidentHash } from './incidents.ts';

export type RemedyKind = 'environment.start' | 'inputs.recheck';
export interface RemedyAction {
  projectId: string;
  incidentId: string;
  kind: RemedyKind;
  target: string;
  version: string;
  costUsd: number | null;
}
export interface RemedyRule {
  kind: RemedyKind;
  target: string;
  maxCostUsd: number;
}
export interface RemedyPolicy {
  revision: number;
  mode: 'confirm' | 'automatic' | 'delegated';
  expiresAt: number;
  rules: RemedyRule[];
  denied: { kind: RemedyKind; target: string }[];
}
export interface RemedyApproval {
  action: string;
  policyRevision: number;
  expiresAt: number;
  author: 'owner' | 'coordinator';
  decision: 'allow' | 'deny';
  revoked?: boolean;
  consumed?: boolean;
}
export const remedyKey = (action: RemedyAction): string => incidentHash(action);

/** An automatic rule for a new input is not permission to dispatch an old prepared request. */
export function requireRemedyDispatch(
  requested: RemedyAction,
  current: RemedyAction | undefined,
  policy: RemedyPolicy,
  approval: RemedyApproval | undefined,
  now: number,
): void {
  if (
    !current ||
    remedyKey(requested) !== remedyKey(current) ||
    remedyAuthority(current, policy, approval, now) !== 'allowed'
  )
    throw new Error('Remedy authority changed before dispatch');
}

/** Neither model prose nor a broad worker sandbox is authority for a coordinator action. */
export function remedyAuthority(
  action: RemedyAction,
  policy: RemedyPolicy,
  approval: RemedyApproval | undefined,
  now: number,
): 'allowed' | 'denied' | 'confirmation' | 'delegation' {
  if (!['environment.start', 'inputs.recheck'].includes(action.kind)) return 'denied';
  if (policy.denied.some((r) => r.kind === action.kind && r.target === action.target))
    return 'denied';
  if (approval?.decision === 'deny' && approval.action === remedyKey(action)) return 'denied';
  if (approval?.revoked || approval?.consumed || now >= policy.expiresAt) return 'denied';
  const exact =
    approval?.action === remedyKey(action) &&
    approval.policyRevision === policy.revision &&
    now < approval.expiresAt;
  // Unknown spend is never treated as zero, even under delegation or a previous approval.
  if (action.costUsd === null || !Number.isFinite(action.costUsd) || action.costUsd < 0)
    return 'denied';
  const permitted = policy.rules.some(
    (r) => r.kind === action.kind && r.target === action.target && action.costUsd! <= r.maxCostUsd,
  );
  if (exact && approval?.author === 'owner') return 'allowed';
  if (policy.mode === 'confirm' || !permitted) return 'confirmation';
  if (policy.mode === 'automatic') return 'allowed';
  return exact && approval?.author === 'coordinator' ? 'allowed' : 'delegation';
}

export function parseRemedyPolicy(raw: unknown, revision: number): RemedyPolicy {
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error('Invalid coordinator policy revision');
  if (!raw || typeof raw !== 'object') throw new Error('Invalid coordinator policy');
  const p = raw as RemedyPolicy;
  if (
    !['confirm', 'automatic', 'delegated'].includes(p.mode) ||
    !Number.isSafeInteger(p.expiresAt) ||
    p.expiresAt <= 0 ||
    !Array.isArray(p.rules) ||
    !Array.isArray(p.denied)
  )
    throw new Error('Invalid coordinator policy');
  const rule = (r: RemedyRule, bounded: boolean) => {
    if (
      !['environment.start', 'inputs.recheck'].includes(r.kind) ||
      typeof r.target !== 'string' ||
      !r.target.trim() ||
      (bounded && (!Number.isFinite(r.maxCostUsd) || r.maxCostUsd < 0))
    )
      throw new Error('Policy requires exact action/target and finite spending limit');
    return { kind: r.kind, target: r.target, ...(bounded ? { maxCostUsd: r.maxCostUsd } : {}) };
  };
  return {
    revision,
    mode: p.mode,
    expiresAt: p.expiresAt,
    rules: p.rules.map((r) => rule(r, true) as RemedyRule),
    denied: p.denied.map((r) => rule(r as RemedyRule, false)),
  };
}
