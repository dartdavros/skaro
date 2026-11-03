import assert from 'node:assert/strict';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { inspectVerificationAcceptance } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { RuntimeProcessIdentity, SkaroScope } from '@skaro/timeline';
import type { Services } from '../app-services';
import { c4ReviewKey } from '../c4-review';
import { extensionSession, approvedTool } from './extension-session';
import { commandDependencies } from './host-dependencies';

/** Real Cat-pilot records/handlers; no active task is fabricated or submitted. */
export async function verifyAcceptanceInspection(
  services: Services,
  directory: string,
  owner: RuntimeProcessIdentity,
) {
  const projects = services.db.shell
    .list()
    .filter((project) => project.name.toLowerCase() === 'cat-pilot');
  assert.equal(projects.length, 1);
  const project = projects[0]!;
  const context = services.projects.get(project.id);
  const task = await context.store.readTask('T-008');
  const taskBefore = JSON.stringify(task);
  const reviewBefore = structuredClone(
    services.db.getSetting(c4ReviewKey(project.id, task.id), null),
  );
  const scope: SkaroScope = {
    kind: 'task',
    projectId: project.id,
    taskId: task.id,
    runId: 'verification-inspection-no-active-run',
  };
  const admission = {
    id: `acceptance-${owner.pid}`,
    sessionId: 'extensions-acceptance',
    generation: 1,
  };
  const admissions = {
    async requireActive(value: typeof admission, signal: AbortSignal) {
      signal.throwIfAborted();
      assert.deepEqual(value, admission);
      assert.equal(await processBirth(owner.pid), owner.birth);
      signal.throwIfAborted();
    },
  };
  const port = services.runs.builtinAcceptance(scope, admissions);
  const signal = new AbortController().signal;
  const state = await port.inspect(admission, signal);
  assert(state.criteria.length > 0);
  assert(
    state.criteria.every((item) =>
      item.id.startsWith(`${project.id}:${task.id}:${state.criteriaRevision}:`),
    ),
  );
  assert.equal(state.continuation, 'blocked');
  assert.deepEqual(state.binding, {
    scope,
    checkout: await realpath(context.root),
    execution: 'blocked',
  });
  const session = await extensionSession(directory, 'acceptance', owner, undefined, context.root, {
    dependencies: await commandDependencies(),
  });
  try {
    const check = (await approvedTool(session, 'workspace-check', 'run_check', {
      name: 'Cat-pilot workspace integrity',
      command: 'git diff --check',
      criteria: [state.criteria[0]!.id],
    })) as unknown as { outcome: string; evidence: { sequence: number; hash: string } };
    assert.equal(check.outcome, 'passed');
    const validation = await session.execute({
      id: 'validate-dependencies',
      action: { type: 'tool', name: 'check_evidence', args: check.evidence },
    });
    const measured = validation.result.value as {
      environmentCurrent: boolean;
      dependencyMeasurement: { files: { id: string; sha256: string }[] };
    };
    assert.equal(measured.environmentCurrent, true);
    assert.deepEqual(
      measured.dependencyMeasurement.files.map((item) => item.id),
      ['host-runtime', 'powershell', 'git-launcher', 'command-worker'],
    );
    const verdicts = state.criteria.map((item) => ({
      id: item.id,
      met: false,
      evidence: [] as { sequence: number; hash: string }[],
    }));
    // These are deliberately unsupported proposals, not verdicts about Cat-pilot features.
    verdicts[0] = { id: state.criteria[0]!.id, met: true, evidence: [check.evidence] };
    const base = {
      journal: session.journal,
      host: port,
      admission,
      criteriaRevision: state.criteriaRevision,
      verdicts,
      signal,
    };
    const inspecting = inspectVerificationAcceptance({ ...base, id: 'actual-evidence' });
    await assert.rejects(
      inspectVerificationAcceptance({ ...base, id: 'actual-evidence' }),
      /already being inspected/,
    );
    const assessed = await inspecting;
    assert.equal(assessed.readyToSubmit, false);
    assert(assessed.reasons.some((reason) => reason.includes('environment/dependencies')));
    assert(!assessed.reasons.some((reason) => /checkout|journal session/.test(reason)));
    const stale = await inspectVerificationAcceptance({
      ...base,
      id: 'stale-revision',
      criteriaRevision: '0'.repeat(64),
    });
    assert(stale.reasons.includes('Criterion revision changed'));
    const unknown = await inspectVerificationAcceptance({
      ...base,
      id: 'unknown-id',
      verdicts: [{ id: 'not-a-task-criterion', met: true, evidence: [check.evidence] }],
    });
    assert(unknown.reasons.includes('Unknown criterion ID'));
    const forged = await inspectVerificationAcceptance({
      ...base,
      id: 'forged-reference',
      verdicts: [{ ...verdicts[0]!, evidence: [{ sequence: 1, hash: '0'.repeat(64) }] }],
    });
    assert(forged.reasons.includes('Invalid or unavailable evidence reference'));
    await assert.rejects(
      inspectVerificationAcceptance({ ...base, id: 'actual-evidence' }),
      /already recorded/,
    );
    const rejected = await services.runs.submitResult(
      {
        summary: 'Read-only inspection; no submission requested',
        criteria: [],
        commitMessage: ':white_check_mark: test: inspect acceptance',
      },
      scope,
    );
    assert(rejected.isError && rejected.text.includes('no longer the current run'));
    assert.equal(JSON.stringify(await context.store.readTask(task.id)), taskBefore);
    assert.deepEqual(services.db.getSetting(c4ReviewKey(project.id, task.id), null), reviewBefore);
    return {
      project: project.name,
      taskId: task.id,
      criteria: state.criteria.length,
      c4: state.c4,
      continuation: state.continuation,
      actualEvidenceBlocked: true,
      measuredDependencies: measured.dependencyMeasurement.files,
      unknownCriteriaRejected: true,
      staleCriteriaRejected: true,
      forgedReferenceRejected: true,
      assessmentReuseRejected: true,
      concurrentAssessmentRejected: true,
      projectCheckoutBound: true,
      inactiveSubmitRejected: true,
      taskAndC4Unchanged: true,
      modelRequests: 0,
      journal: join(directory, 'acceptance.jsonl'),
    };
  } finally {
    await session.dispose();
  }
}
