import assert from 'node:assert/strict';
import { RuntimeSession, type RuntimeVerificationHost } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { RuntimeProcessIdentity, RuntimeAcceptanceState } from '@skaro/timeline';
import type { Services } from '../app-services';
import { c4ReviewKey } from '../c4-review';
import { extensionSession, approvedTool } from './extension-session';

/** Read actual criteria; deliberately invalid run scope cannot launch a project command. */
export async function verifyCheckPlans(
  services: Services,
  directory: string,
  owner: RuntimeProcessIdentity,
) {
  const project = services.db.shell
    .list()
    .filter((item) => item.name.toLowerCase() === 'cat-pilot');
  assert.equal(project.length, 1);
  const context = services.projects.get(project[0]!.id);
  const task = await context.store.readTask('T-008');
  const before = JSON.stringify(task);
  const c4 = structuredClone(services.db.getSetting(c4ReviewKey(context.id, task.id), null));
  const scope = {
    kind: 'task' as const,
    projectId: context.id,
    taskId: task.id,
    runId: 'verification-plan-no-active-run',
  };
  const admission = { id: `plans-${owner.pid}`, sessionId: 'extensions-plans', generation: 1 };
  const verification: RuntimeVerificationHost = {
    scope,
    admission,
    acceptance: services.runs.builtinAcceptance(scope, {
      async requireActive(value, signal) {
        signal.throwIfAborted();
        assert.deepEqual(value, admission);
        assert.equal(await processBirth(owner.pid), owner.birth);
      },
    }),
  };
  let session = await extensionSession(directory, 'plans', owner, undefined, context.root, {
    verification,
  });
  const tool = async (id: string, name: string, args: unknown) => {
    const record = await session.execute({ id, action: { type: 'tool', name, args } });
    return record.result;
  };
  try {
    const inspected = await tool('inspect', 'inspect_acceptance', {});
    assert(!inspected.error, inspected.error);
    const state = inspected.value as RuntimeAcceptanceState;
    assert(
      (await tool('scope-args', 'inspect_acceptance', { projectId: context.id })).error?.includes(
        'Invalid arguments',
      ),
    );
    assert.equal(state.binding?.execution, 'blocked');
    assert(state.criteria.length && state.criteria.every((item) => item.text));
    const command = {
      name: 'Workspace integrity proposal',
      criteria: [state.criteria[0]!.id],
      command: 'git diff --check',
    };
    const input = {
      criteriaRevision: state.criteriaRevision,
      checks: [{ ...command, id: 'workspace' }],
      uncovered: state.criteria.slice(1).map((item) => ({
        id: item.id,
        reason: 'This probe does not verify the product requirement',
      })),
    };
    const planned = await tool('plan', 'plan_checks', input);
    assert(!planned.error, planned.error);
    const result = planned.value as {
      plan: { sequence: number; hash: string };
      origin: string;
      limitations: string[];
    };
    assert.equal(result.origin, 'model');
    assert(result.limitations.length > 0);
    assert(
      (
        await tool('duplicate-step', 'plan_checks', {
          ...input,
          checks: [input.checks[0], input.checks[0]],
        })
      ).error?.includes('Duplicate check'),
    );
    assert(
      (
        await tool('stale', 'plan_checks', { ...input, criteriaRevision: '0'.repeat(64) })
      ).error?.includes('Criterion revision changed'),
    );
    assert(
      (await tool('missing-criterion', 'plan_checks', { ...input, uncovered: [] })).error?.includes(
        'every authoritative criterion',
      ),
    );
    assert(
      (await tool('plan-as-proof', 'check_evidence', result.plan)).error?.includes(
        'Unsupported verification evidence',
      ),
    );
    const plan = { ...result.plan, stepId: 'workspace' };
    await assert.rejects(
      approvedTool(session, 'weakened', 'run_check', {
        ...command,
        command: 'git status --short',
        plan,
      }),
      /differs from its planned command/,
    );
    await assert.rejects(
      approvedTool(session, 'forged', 'run_check', {
        ...command,
        plan: { ...plan, hash: '0'.repeat(64) },
      }),
      /Unknown verification plan/,
    );
    await assert.rejects(
      approvedTool(session, 'changed-coverage', 'run_check', {
        ...command,
        criteria: [state.criteria[1]!.id],
        plan,
      }),
      /differs from its planned command/,
    );
    await assert.rejects(
      approvedTool(session, 'inactive', 'run_check', { ...command, plan }),
      /does not admit check execution/,
    );
    await assert.rejects(
      approvedTool(session, 'no-plan', 'run_check', command),
      /require an authoritative verification plan/,
    );
    assert.equal(Object.keys(session.journal.state.processes).length, 0);
    const assessed = await tool('assess', 'assess_checks', {
      criteriaRevision: state.criteriaRevision,
      verdicts: state.criteria.map(({ id }) => ({ id, met: false, evidence: [] })),
    });
    assert(!assessed.error, assessed.error);
    assert.equal((assessed.value as { readyToSubmit: boolean }).readyToSubmit, false);
    const config = structuredClone(session.journal.state.config!);
    await session.dispose();
    await assert.rejects(RuntimeSession.open(config, owner), /Authoritative verification host/);
    session = await RuntimeSession.open(config, owner, undefined, verification);
    assert(session.journal.find('verification-plan:plan:result'));
    assert(!(await tool('after-restart', 'inspect_acceptance', {})).error);
    assert.equal(JSON.stringify(await context.store.readTask(task.id)), before);
    assert.deepEqual(services.db.getSetting(c4ReviewKey(context.id, task.id), null), c4);
    return {
      project: 'Cat-pilot',
      taskId: task.id,
      criteria: state.criteria.length,
      authoritativePlan: true,
      staleRevisionRejected: true,
      incompleteCoverageRejected: true,
      planIsNotEvidence: true,
      changedCommandRejected: true,
      changedCoverageRejected: true,
      duplicateStepRejected: true,
      modelCannotWidenScope: true,
      forgedPlanRejected: true,
      inactiveRunRejected: true,
      unplannedCheckRejected: true,
      processesStarted: 0,
      restartRequiresHost: true,
      planRetainedAfterRestart: true,
      taskAndC4Unchanged: true,
      modelRequests: 0,
    };
  } finally {
    await session.dispose();
  }
}
