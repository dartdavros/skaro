import assert from 'node:assert/strict';
import { RuntimeSession, toolCatalog } from '@skaro/agent-runtime';
import type { RuntimeProcessIdentity, RuntimeAcceptanceState } from '@skaro/timeline';
import type { Services } from '../app-services';
import { c4ReviewKey } from '../c4-review';
import { extensionSession, approvedTool } from './extension-session';
import { catPilotVerificationTarget } from './task-verification';
import {
  modelPlanInspection,
  modelPlanToolAdmission,
  prepareModelPlan,
} from './model-plan-request';

/** Read actual criteria; deliberately invalid run scope cannot launch a project command. */
export async function verifyCheckPlans(
  services: Services,
  directory: string,
  owner: RuntimeProcessIdentity,
) {
  const { context, task, verification } = await catPilotVerificationTarget(
    services,
    owner,
    'extensions-plans',
    'verification-plan-no-active-run',
  );
  const before = JSON.stringify(task);
  const c4 = structuredClone(services.db.getSetting(c4ReviewKey(context.id, task.id), null));
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
    const payload = await prepareModelPlan(directory, state, session.journal.state.config!.route);
    const policy = modelPlanToolAdmission(modelPlanInspection(state));
    const catalogue = toolCatalog().map(({ name, inputSchema }) => ({
      name,
      description: name,
      parameters: inputSchema,
    }));
    assert.deepEqual(
      policy.selectChatTools!(catalogue).map((item) => item.name),
      ['inspect_acceptance'],
    );
    assert.throws(() => policy.requireAllowed('run_check', command));
    assert.deepEqual(policy.projectResult({ value: state }), modelPlanInspection(state));
    assert.throws(() => policy.requireAllowed('plan_checks', input));
    const uncovered = {
      criteriaRevision: state.criteriaRevision,
      checks: [],
      uncovered: state.criteria.map(({ id }) => ({
        id,
        reason: 'No execution authorized in this probe',
      })),
    };
    policy.requireAllowed('plan_checks', uncovered);
    const actualPlan = await tool('model-empty-plan', 'plan_checks', uncovered);
    assert(!actualPlan.error, actualPlan.error);
    policy.projectResult(actualPlan);
    assert.deepEqual(
      policy.selectChatTools!(catalogue).map((item) => item.name),
      ['assess_checks'],
    );
    assert.throws(() =>
      policy.requireAllowed('assess_checks', {
        criteriaRevision: state.criteriaRevision,
        verdicts: state.criteria.map(({ id }) => ({ id, met: true, evidence: [] })),
      }),
    );
    policy.projectResult(assessed);
    assert.deepEqual(policy.selectChatTools!(catalogue), []);
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
      modelPayload: payload,
    };
  } finally {
    await session.dispose();
  }
}
