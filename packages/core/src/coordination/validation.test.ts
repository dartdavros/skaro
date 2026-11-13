import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { coordinationEvidence, coordinationRequest } from './validation.ts';

it('rejects raw payloads/secrets, missing mutation versions and cross-project causal links', () => {
  const inputHash = createHash('sha256').update(process.cwd()).digest('hex');
  const source = { kind: 'controller', id: process.cwd() };
  const subject = { kind: 'document', id: process.cwd() };
  const event = {
    id: 'observation',
    projectId: process.cwd(),
    kind: 'filesystem.observed',
    source,
    subject,
    inputHash,
  };
  const intent = {
    id: 'record',
    projectId: event.projectId,
    eventId: event.id,
    source,
    subject,
    inputHash,
    action: 'observation.record',
  };
  const operation = {
    id: 'record',
    projectId: event.projectId,
    eventId: event.id,
    intentId: intent.id,
    idempotencyKey: 'record',
    subject,
    inputHash,
    action: intent.action,
    scopeKey: 'project:mutation',
    mode: 'mutation',
  };
  expect(() => coordinationRequest({ event, intent, operation })).toThrow(
    'expected project version',
  );
  const valid = { ...operation, expectedVersion: 0 };
  expect(coordinationRequest({ event, intent, operation: valid }).operation.expectedVersion).toBe(
    0,
  );
  expect(() =>
    coordinationRequest({ event, intent, operation: { ...valid, args: ['secret'] } }),
  ).toThrow('Unsupported');
  expect(() =>
    coordinationRequest({
      event,
      intent: { ...intent, projectId: 'different-scope' },
      operation: valid,
    }),
  ).toThrow('inconsistent scope');
  expect(() => coordinationEvidence({ code: 'failed', refs: [], error: 'raw exception' })).toThrow(
    'Unsupported',
  );
  expect(() => coordinationEvidence({ code: 'raw error text', refs: [] })).toThrow('code');
});
