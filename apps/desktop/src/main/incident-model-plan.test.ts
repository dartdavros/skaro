import { expect, it } from 'vitest';
import { AppDb, incidentHash, type CoordinationBlocker } from '@skaro/core';
import {
  incidentDiagnosisId,
  incidentModelPlan,
  incidentPlanKey,
  parseIncidentOptions,
} from './incident-model-plan';

it('requires actionable distinct options with consequences and invalidates plans on changed authority', () => {
  expect(() => parseIncidentOptions([])).toThrow('two or three');
  expect(() =>
    parseIncidentOptions([
      { label: 'fix', description: '' },
      { label: 'wait', description: 'blocked' },
    ]),
  ).toThrow('consequences');
  expect(() =>
    parseIncidentOptions([
      { label: 'same', description: 'a' },
      { label: 'same', description: 'b' },
    ]),
  ).toThrow('differ');
  const options = parseIncidentOptions([
    {
      label: 'Repair the declared dependency',
      description: 'I will run the project setup and verify its configured check',
    },
    { label: 'Keep this task paused', description: 'No services or task files will be changed' },
  ]);
  const db = AppDb.open(':memory:');
  try {
    // Pure incident DTO/SQLite metadata contract, no substituted project/backend/agent.
    const row = {
      id: 'incident',
      protocol: {
        cause: 'dependency',
        condition: 'inputs-current',
        resourceVersion: incidentHash('resource'),
        ownerPolicyRevision: 1,
        subscriptions: [
          { taskId: 'task', runId: 'run', inputs: incidentHash('inputs'), intent: 1 },
        ],
      },
    } as CoordinationBlocker;
    const plan = {
      explanation: 'The declared dependency is absent',
      question: 'Which action should I take?',
      options,
      resourceVersion: row.protocol!.resourceVersion,
      policyRevision: 1,
      subscriptions: incidentHash(row.protocol!.subscriptions),
    };
    db.setSetting(incidentPlanKey(row.id), plan);
    expect(incidentModelPlan(db, row)).toEqual(plan);
    const uncheckable = {
      ...row,
      protocol: {
        ...row.protocol!,
        cause: 'external' as const,
        condition: 'owner-evidence' as const,
      },
    };
    expect(incidentModelPlan(db, uncheckable)).toBeUndefined();
    db.setSetting(incidentPlanKey(row.id), {
      ...plan,
      verificationSession: { runId: 'run', failedTurnId: 'exit' },
    });
    expect(incidentModelPlan(db, uncheckable)).toHaveProperty(
      'verificationSession.failedTurnId',
      'exit',
    );
    db.setSetting(incidentPlanKey(row.id), plan);
    for (const protocol of [
      { ...row.protocol!, resourceVersion: incidentHash('different') },
      { ...row.protocol!, ownerPolicyRevision: 2 },
      { ...row.protocol!, subscriptions: [{ ...row.protocol!.subscriptions[0]!, intent: 2 }] },
    ]) {
      expect(incidentModelPlan(db, { ...row, protocol })).toBeUndefined();
      expect(incidentDiagnosisId({ ...row, protocol })).not.toBe(incidentDiagnosisId(row));
    }
  } finally {
    db.close();
  }
});
