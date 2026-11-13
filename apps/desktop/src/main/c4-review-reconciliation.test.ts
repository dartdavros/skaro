import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { coordinationRequest } from './project-coordinator-request';
import { C4SemanticStore } from './c4-semantic-store';
import { semanticTestObservation } from './c4-semantic-test-input';
import { c4SemanticFingerprint } from './c4-semantic-result';
import { failedReadonlyC4Review } from './c4-review-reconciliation';

it('requires a new owner intent and exact failed review identity before reconciling an uncertain control', async () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Repository metadata', path: process.cwd() });
    const observation = await semanticTestObservation();
    observation.impact.projectId = project.id;
    const { runId, taskId } = observation.impact,
      contextHash = observation.architectureHash;
    const fingerprint = c4SemanticFingerprint(observation, contextHash),
      store = new C4SemanticStore(db);
    const saved = store.request({
      version: 1,
      projectId: project.id,
      taskId,
      runId,
      observation,
      contextHash,
      fingerprint,
      intent: 1,
      dispatchRevision: 1,
      state: 'queued',
      id: C4SemanticStore.id(project.id, runId, fingerprint, 1),
    });
    const running = store.update(saved, {
      state: 'running',
      worker: `c4-review-${saved.id}-metadata`,
    });
    const failed = store.update(running, { state: 'failed', error: 'Rejected semantic evidence' });
    const op = db.coordination.accept(
      coordinationRequest({
        id: `c4.semantic:${saved.id}`,
        projectId: project.id,
        action: 'c4.semantic.review',
        source: { kind: 'controller', id: 'project-coordinator' },
        subject: { kind: 'run', id: runId },
        scopeKey: `c4.review:${runId}`,
        mode: 'control',
        inputHash: fingerprint,
      }),
    );
    const claim = db.coordination.claim(project.id, op.id, {
      expectedRevision: op.revision,
      claimId: 'metadata-proof',
    });
    const uncertain = db.coordination.finish(project.id, op.id, {
      expectedRevision: claim.operation.revision,
      claimId: 'metadata-proof',
      state: 'uncertain',
      evidence: { code: 'dispatch_result_unknown', refs: [op.subject] },
    });
    expect(failedReadonlyC4Review(uncertain, failed, project.id, runId, 2)).toBe(true);
    expect(failedReadonlyC4Review(uncertain, failed, project.id, runId, 1)).toBe(false);
    expect(failedReadonlyC4Review(uncertain, failed, project.id, 'other-run', 2)).toBe(false);
    expect(
      failedReadonlyC4Review(
        uncertain,
        { ...failed, worker: 'other-process' },
        project.id,
        runId,
        2,
      ),
    ).toBe(false);
    expect(
      failedReadonlyC4Review(uncertain, { ...failed, state: 'verified' }, project.id, runId, 2),
    ).toBe(false);
    expect(
      failedReadonlyC4Review(
        { ...uncertain, inputHash: 'other-input' },
        failed,
        project.id,
        runId,
        2,
      ),
    ).toBe(false);
    expect(
      failedReadonlyC4Review({ ...uncertain, mode: 'mutation' }, failed, project.id, runId, 2),
    ).toBe(false);
    expect(db.coordination.getOperation(project.id, op.id)?.state).toBe('uncertain');
  } finally {
    db.close();
  }
});
