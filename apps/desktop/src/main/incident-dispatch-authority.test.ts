import { expect, it } from 'vitest';
import { remedyKey, type RemedyAction, type RemedyPolicy, type RemedyApproval } from '@skaro/core';
import { IncidentDispatchAuthority } from './incident-dispatch-authority';

const action: RemedyAction = {
  projectId: 'p',
  incidentId: 'i',
  kind: 'environment.start',
  target: 'environment',
  version: 'current',
  costUsd: 0,
};
const policy: RemedyPolicy = {
  revision: 1,
  mode: 'confirm',
  expiresAt: 1000,
  rules: [],
  denied: [],
};
const approval: RemedyApproval = {
  action: remedyKey(action),
  policyRevision: 1,
  author: 'owner',
  decision: 'allow',
  expiresAt: 900,
};

it('allows an admitted exact operation to finish after expiry without allowing a late or restarted dispatch', () => {
  const running = new IncidentDispatchAuthority(action);
  running.validate(action, policy, approval, 100);
  running.enter();
  expect(() => running.validate(action, policy, approval, 2000)).not.toThrow();
  const late = new IncidentDispatchAuthority(action);
  late.enter(); // An enter call without fresh validation grants nothing.
  expect(() => late.validate(action, policy, approval, 2000)).toThrow();
});

it('retains live revocation, scope and policy fences throughout the admitted operation', () => {
  const running = new IncidentDispatchAuthority(action);
  running.validate(action, policy, approval, 100);
  running.enter();
  for (const blocked of [
    { ...approval, revoked: true },
    { ...approval, consumed: true },
    { ...approval, decision: 'deny' as const },
  ])
    expect(() => running.validate(action, policy, blocked, 2000)).toThrow();
  expect(() =>
    running.validate({ ...action, version: 'changed' }, policy, approval, 2000),
  ).toThrow();
  expect(() => running.validate(action, { ...policy, revision: 2 }, approval, 2000)).toThrow();
  expect(() => running.validate(action, { ...policy, denied: [action] }, approval, 2000)).toThrow();
});
