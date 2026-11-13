import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { semanticTestObservation } from './c4-semantic-test-input';
import { c4SemanticFingerprint } from './c4-semantic-result';
import { C4SemanticStore, type C4SemanticJob } from './c4-semantic-store';
import { c4RecordProtocol } from './c4-record-protocol';

it('persists review identity once and fences stale CAS, invalid transitions and incomplete native receipts', async () => {
  const observation = await semanticTestObservation(),
    db = AppDb.open(':memory:');
  try {
    const store = new C4SemanticStore(db),
      contextHash = observation.architectureHash;
    const fingerprint = c4SemanticFingerprint(observation, contextHash);
    const { projectId, taskId, runId } = observation.impact;
    const job: C4SemanticJob = {
      version: 1,
      projectId,
      taskId,
      runId,
      observation,
      fingerprint,
      contextHash,
      intent: 1,
      dispatchRevision: 0,
      state: 'queued',
      id: C4SemanticStore.id(projectId, runId, fingerprint, 1),
    };
    expect(store.request(job)).toEqual(job);
    expect(store.request(job)).toEqual(job);
    const running = store.update(job, { state: 'running', worker: 'independent-protocol-worker' });
    expect(() => store.update(job, { state: 'running' })).toThrow(/changed/);
    expect(() => store.update(running, { state: 'verified' })).toThrow(/native/);
    const uncertain = store.update(running, {
      state: 'uncertain',
      error: 'Unknown physical outcome',
    });
    expect(() => store.update(uncertain, { state: 'running' })).toThrow(/transition/);
    expect(store.current(runId)?.state).toBe('uncertain');
    expect(() => store.request({ ...job, runId: 'foreign' })).toThrow(/identity/);
  } finally {
    db.close();
  }
});

it('preserves legacy records and rejects unknown persisted package protocols', () => {
  expect(c4RecordProtocol({})).toBe('package-v1');
  expect(c4RecordProtocol({ protocol: 'impact-v1' })).toBe('impact-v1');
  expect(() => c4RecordProtocol({ protocol: 'future-v2' })).toThrow();
});
