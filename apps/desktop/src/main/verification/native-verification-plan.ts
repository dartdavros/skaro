import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { AgentSession, RuntimeAcceptanceState } from '@skaro/timeline';
import type { JournalRecord } from '@skaro/agent-runtime';

async function tool(session: AgentSession, id: string, name: string, args: unknown) {
  assert('invokeTool' in session && typeof session.invokeTool === 'function');
  return session.invokeTool(name, args, id);
}

/** A local uncovered proposal, never a model-generated plan or acceptance evidence. */
export async function verifyNativePlan(session: AgentSession, state: RuntimeAcceptanceState) {
  const input = {
    criteriaRevision: state.criteriaRevision,
    checks: [],
    uncovered: state.criteria.map(({ id }) => ({
      id,
      reason: 'This native transport probe does not verify the product requirement',
    })),
  };
  const plan = (await tool(session, 'native-plan', 'plan_checks', input)) as {
    kind: string;
    criteriaRevision: string;
    uncovered: typeof input.uncovered;
    plan: { sequence: number; hash: string };
  };
  assert.equal(plan.kind, 'verification-plan');
  assert.equal(plan.criteriaRevision, state.criteriaRevision);
  assert.deepEqual(plan.uncovered, input.uncovered);
  assert(Number.isInteger(plan.plan.sequence) && plan.plan.sequence > 0);
  assert.match(plan.plan.hash, /^[a-f0-9]{64}$/);
  await assert.rejects(
    tool(session, 'native-plan-not-evidence', 'check_evidence', plan.plan),
    /Unsupported verification evidence/,
  );
  const assessmentInput = {
    criteriaRevision: state.criteriaRevision,
    verdicts: state.criteria.map(({ id }) => ({ id, met: false, evidence: [] })),
  };
  const assessment = (await tool(
    session,
    'native-assessment',
    'assess_checks',
    assessmentInput,
  )) as { readyToSubmit: boolean; reasons: string[]; verdicts: typeof assessmentInput.verdicts };
  assert.equal(assessment.readyToSubmit, false);
  assert.deepEqual(assessment.verdicts, assessmentInput.verdicts);
  for (const { id } of state.criteria)
    assert(assessment.reasons.includes(`Criterion lacks a supported positive verdict: ${id}`));
  return { input, plan, assessmentInput, assessment };
}

/** Replay the actual persisted calls after a genuine native restart; inspect again separately. */
export async function verifyNativePlanRestart(
  session: AgentSession,
  previous: Awaited<ReturnType<typeof verifyNativePlan>>,
) {
  assert.deepEqual(
    await tool(session, 'native-plan', 'plan_checks', previous.input),
    previous.plan,
  );
  assert.deepEqual(
    await tool(session, 'native-assessment', 'assess_checks', previous.assessmentInput),
    previous.assessment,
  );
  const fresh = (await tool(
    session,
    'native-assessment-after-restart',
    'assess_checks',
    previous.assessmentInput,
  )) as { readyToSubmit: boolean };
  assert.equal(fresh.readyToSubmit, false);
}

/** Called only after the real owner exits; read the existing primary journal. */
export async function inspectNativePlanJournal(
  path: string,
  previous: Awaited<ReturnType<typeof verifyNativePlan>>,
) {
  const records = (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as JournalRecord);
  const plans = records.filter((record) => record.id === 'verification-plan:native-plan:result');
  assert.equal(plans.length, 1);
  const record = plans[0]!;
  const { plan: reference, ...value } = previous.plan;
  assert.equal(record.sequence, reference.sequence);
  assert.equal(record.hash, reference.hash);
  assert.deepEqual(record.result.value, value);
  for (const id of ['native-assessment', 'native-assessment-after-restart'])
    assert.equal(records.filter((item) => item.id === `verification-assessment:${id}`).length, 1);
  assert.equal(
    records.flatMap((item) => item.facts).filter((fact) => fact.type === 'process').length,
    0,
  );
  return {
    uncoveredCriteria: previous.input.uncovered.length,
    planReference: reference,
    readyToSubmit: false,
    planIsNotEvidence: true,
    callsReplayedAfterRestart: true,
    freshAssessmentAfterRestart: true,
    duplicatePlanRecords: 0,
    checkProcesses: 0,
  };
}
