import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { semanticTestObservation } from './c4-semantic-test-input';
import { c4SemanticFingerprint, type C4SemanticVerdict } from './c4-semantic-result';
import { C4SemanticStore, type C4SemanticJob } from './c4-semantic-store';
import { c4PackageBlocks, saveC4PackagePolicy } from './c4-package-policy';
import type { C4ProposalRecord } from './c4-service';

/** Isolated protocol metadata only. No project/task/native agent/backend is registered or simulated. */
it('requires a matching independent classification for optional bypass and keeps required decisions blocking', async () => {
  const observation = await semanticTestObservation(),
    db = AppDb.open(':memory:');
  try {
    const { projectId, taskId, runId } = observation.impact;
    const store = new C4SemanticStore(db),
      contextHash = observation.architectureHash;
    const fingerprint = c4SemanticFingerprint(observation, contextHash);
    const record = (id: string): C4ProposalRecord => ({
      protocol: 'impact-v1',
      scope: { kind: 'task', projectId, taskId, runId },
      package: {
        id,
        title: 'Protocol classification',
        summary: 'Metadata check',
        baseRevision: 1,
        files: [],
        task: { id: taskId, runId },
      },
      item: {
        id,
        turnId: '',
        kind: 'proposal',
        state: 'pending',
        status: 'done',
        startedAt: 0,
        native: { agent: 'skaro', type: 'proposal', ref: 'architecture' },
        proposal: {
          type: 'architecture',
          packageId: id,
          title: 'Protocol classification',
          summary: 'Metadata check',
          baseRevision: 1,
        },
      },
    });
    const classify = (entry: C4ProposalRecord, category: 'optional' | 'decision') => {
      const id = C4SemanticStore.id(projectId, runId, fingerprint, 1, entry.item.id);
      const job: C4SemanticJob = {
        version: 1,
        id,
        projectId,
        taskId,
        runId,
        intent: 1,
        dispatchRevision: 0,
        fingerprint,
        contextHash,
        observation,
        packageId: entry.item.id,
        state: 'queued',
      };
      store.request(job);
      const running = store.update(job, { state: 'running', worker: 'protocol-worker' });
      const verdict: C4SemanticVerdict = {
        version: 1,
        fingerprint,
        category,
        implementation: category === 'optional' ? 'aligned' : 'unknown',
        summary: 'Protocol metadata result',
        realized: [],
        evidence: observation.files.map((f) => ({
          ...f,
          detail: 'Host-observed repository source',
        })),
        conflicts: [],
      };
      const verified = store.update(running, {
        state: 'verified',
        verdict,
        reviewer: {
          worker: 'protocol-worker',
          nativeSessionId: 'protocol-receipt',
          agent: 'protocol',
          log: observation.files[0]!.path,
          logHash: observation.files[0]!.hash!,
        },
      });
      return verified;
    };
    const optional = record('optional-protocol');
    expect(c4PackageBlocks(db, optional, runId)).toBe(true);
    const verified = classify(optional, 'optional');
    saveC4PackagePolicy(db, optional, verified.id, false);
    expect(c4PackageBlocks(db, optional, runId)).toBe(true); // outbox not delivered
    store.update(verified, { delivered: true });
    expect(c4PackageBlocks(db, optional, runId)).toBe(false);
    expect(c4PackageBlocks(db, optional, 'another-run')).toBe(true);
    expect(
      c4PackageBlocks(db, { ...optional, package: { ...optional.package, id: 'changed' } }, runId),
    ).toBe(true);
    expect(
      c4PackageBlocks(db, { ...optional, item: { ...optional.item, state: 'accepted' } }, runId),
    ).toBe(true);
    const required = record('required-protocol'),
      decision = classify(required, 'decision');
    expect(() => saveC4PackagePolicy(db, required, decision.id, false)).toThrow();
    saveC4PackagePolicy(db, required, decision.id, true);
    store.update(decision, { delivered: true });
    expect(c4PackageBlocks(db, required, runId)).toBe(true);
  } finally {
    db.close();
  }
});
