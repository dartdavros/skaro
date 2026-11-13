import { expect, it } from 'vitest';
import {
  incidentHash,
  incidentIdentity,
  incidentSubscribers,
  type IncidentProtocol,
} from './incidents.ts';
import {
  remedyAuthority,
  remedyKey,
  requireRemedyDispatch,
  type RemedyAction,
  type RemedyPolicy,
  type RemedyApproval,
} from './remedy-policy.ts';

const action: RemedyAction = {
  projectId: 'p',
  incidentId: 'incident',
  kind: 'environment.start',
  target: 'environment',
  version: incidentHash('v1'),
  costUsd: 0,
};
const envelope: RemedyPolicy = {
  revision: 1,
  mode: 'confirm',
  expiresAt: 1000,
  rules: [{ kind: action.kind, target: action.target, maxCostUsd: 0 }],
  denied: [],
};
const approval: RemedyApproval = {
  action: remedyKey(action),
  policyRevision: 1,
  expiresAt: 900,
  author: 'owner',
  decision: 'allow',
};

it('requires exact owner approval in confirm mode and rejects stale/revoked authority in every mode', () => {
  expect(remedyAuthority(action, envelope, undefined, 1)).toBe('confirmation');
  for (const mode of ['confirm', 'automatic', 'delegated'] as const) {
    const policy = { ...envelope, mode };
    expect(remedyAuthority(action, policy, approval, 1)).toBe('allowed');
    expect(remedyAuthority(action, policy, { ...approval, decision: 'deny' }, 1)).toBe('denied');
    expect(remedyAuthority(action, policy, { ...approval, revoked: true }, 1)).toBe('denied');
    expect(remedyAuthority(action, policy, { ...approval, consumed: true }, 1)).toBe('denied');
    expect(remedyAuthority(action, policy, approval, 1001)).toBe('denied');
    expect(remedyAuthority(action, { ...policy, denied: [action] }, approval, 1)).toBe('denied');
  }
  expect(remedyAuthority({ ...action, version: incidentHash('v2') }, envelope, approval, 1)).toBe(
    'confirmation',
  );
  expect(remedyAuthority({ ...action, projectId: 'other' }, envelope, approval, 1)).toBe(
    'confirmation',
  );
  expect(remedyAuthority(action, { ...envelope, revision: 2 }, approval, 1)).toBe('confirmation');
  expect(remedyAuthority(action, envelope, approval, 901)).toBe('confirmation');
});

it('bounds automatic and delegated decisions without assuming unknown spend is zero', () => {
  expect(remedyAuthority(action, { ...envelope, mode: 'automatic' }, undefined, 1)).toBe('allowed');
  const policy = { ...envelope, mode: 'delegated' as const };
  expect(remedyAuthority(action, policy, undefined, 1)).toBe('delegation');
  expect(remedyAuthority(action, policy, { ...approval, author: 'coordinator' }, 1)).toBe(
    'allowed',
  );
  expect(remedyAuthority({ ...action, target: 'other' }, policy, approval, 1)).toBe('confirmation');
  expect(remedyAuthority({ ...action, costUsd: 1 }, policy, undefined, 1)).toBe('confirmation');
  expect(remedyAuthority({ ...action, costUsd: null }, policy, approval, 1)).toBe('denied');
});

it('fences each mode at dispatch against changed scope/version, expiry, denial and revoked permission', () => {
  for (const mode of ['confirm', 'automatic', 'delegated'] as const) {
    const policy = { ...envelope, mode };
    const grant = {
      ...approval,
      author: mode === 'delegated' ? ('coordinator' as const) : ('owner' as const),
    };
    expect(() => requireRemedyDispatch(action, action, policy, grant, 1)).not.toThrow();
    for (const current of [
      { ...action, version: incidentHash('new') },
      { ...action, projectId: 'foreign' },
      { ...action, target: 'outside' },
    ])
      expect(() => requireRemedyDispatch(action, current, policy, grant, 1)).toThrow();
    for (const denied of [
      { ...grant, decision: 'deny' as const },
      { ...grant, revoked: true },
      { ...grant, consumed: true },
    ])
      expect(() => requireRemedyDispatch(action, action, policy, denied, 1)).toThrow();
    expect(() => requireRemedyDispatch(action, action, policy, grant, 1001)).toThrow();
    expect(() =>
      requireRemedyDispatch(action, { ...action, costUsd: null }, policy, grant, 1),
    ).toThrow();
  }
});

it('deduplicates a cause and resource version independently from subscriber task or diagnostic prose', () => {
  const protocol: Pick<IncidentProtocol, 'cause' | 'code' | 'resourceVersion' | 'condition'> = {
    cause: 'environment',
    code: 'unavailable',
    resourceVersion: incidentHash('v1'),
    condition: 'environment-ready',
  };
  const id = incidentIdentity('p', 'service', protocol);
  expect(incidentIdentity('p', 'service', { ...protocol })).toBe(id);
  for (const changed of [
    { ...protocol, code: 'auth_failed' },
    { ...protocol, resourceVersion: incidentHash('v2') },
  ])
    expect(incidentIdentity('p', 'service', changed)).not.toBe(id);
  expect(incidentIdentity('another', 'service', protocol)).not.toBe(id);
});

it('shares an incident across tasks while replacing only a renewed task intent and snapshot', () => {
  const a = { taskId: 'A', runId: 'run-A', inputs: incidentHash('A1'), intent: 1 };
  const b = { taskId: 'B', runId: 'run-B', inputs: incidentHash('B1'), intent: 8 };
  const both = incidentSubscribers(incidentSubscribers([], a), b);
  expect(both).toEqual([a, b]);
  expect(incidentSubscribers(both, { ...a, inputs: incidentHash('A2'), intent: 3 })).toEqual([
    b,
    { ...a, inputs: incidentHash('A2'), intent: 3 },
  ]);
  expect(incidentSubscribers(both, b)).toEqual(both);
});
