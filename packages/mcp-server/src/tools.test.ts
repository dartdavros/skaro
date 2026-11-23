import { describe, expect, it } from 'vitest';
import { submitResultTool, type SubmitResultArgs } from './tools.ts';
import { verifyIntegrationTool } from './integration-tool.ts';

const scope = { kind: 'task' as const, projectId: 'p', taskId: 'T-001', runId: 'r' };

describe('submit_result', () => {
  it('passes a well-formed report to Skaro', async () => {
    let got: SubmitResultArgs | undefined;
    const tool = submitResultTool(async (args) => {
      got = args;
      return { text: 'ok' };
    });
    const result = await tool.call(
      {
        summary: ' Сделано. ',
        commit_message: 'feat: add the page',
        criteria: [{ number: 1, met: true, evidence: 'npm test — зелёные' }],
      },
      scope,
    );
    expect(result).toEqual({ text: 'ok' });
    expect(got).toEqual({
      summary: 'Сделано.',
      criteria: [{ number: 1, met: true, evidence: 'npm test — зелёные' }],
      commitMessage: 'feat: add the page',
    });
  });

  it('passes the commit message the agent proposed', async () => {
    let got: SubmitResultArgs | undefined;
    const tool = submitResultTool(async (args) => {
      got = args;
      return { text: 'ok' };
    });
    await tool.call(
      {
        summary: 's',
        commit_message: ' feat: add page skeleton ',
        criteria: [{ number: 1, met: true, evidence: 'e' }],
      },
      scope,
    );
    expect(got?.commitMessage).toBe('feat: add page skeleton');
  });

  it('refuses a report without a commit message', async () => {
    const tool = submitResultTool(() => Promise.reject(new Error('not called')));
    const result = await tool.call(
      { summary: 's', criteria: [{ number: 1, met: true, evidence: 'e' }] },
      scope,
    );
    expect(result.isError).toBe(true);
  });

  it('refuses verdicts without evidence or a number', async () => {
    const tool = submitResultTool(() => Promise.reject(new Error('not called')));
    const noEvidence = await tool.call(
      { summary: 's', commit_message: 'm', criteria: [{ number: 1, met: true, evidence: ' ' }] },
      scope,
    );
    expect(noEvidence.isError).toBe(true);
    const noNumber = await tool.call(
      { summary: 's', commit_message: 'm', criteria: [{ number: 0, met: true, evidence: 'e' }] },
      scope,
    );
    expect(noNumber.isError).toBe(true);
  });

  it('is offered only in task sessions', () => {
    const tool = submitResultTool(() => Promise.resolve({ text: '' }));
    expect(tool.available?.(scope)).toBe(true);
    expect(tool.available?.({ kind: 'project_chat', projectId: 'p', chatId: 'c' })).toBe(false);
  });

  it('keeps an inapplicable method separate from an unavailable required outcome', async () => {
    let report: SubmitResultArgs | undefined;
    const tool = submitResultTool(async (input) => {
      report = input;
      return { text: 'recorded' };
    });
    const criterion = {
      number: 1,
      met: false,
      status: 'unavailable',
      evidence: 'Authorized provider account required',
    };
    const observations = [
      { name: 'Browser review', outcome: 'not_applicable', reason: 'No browser behavior changed' },
    ];
    const input = {
      summary: 'Backend updated',
      commit_message: 'fix: update backend',
      criteria: [criterion],
      verification_observations: observations,
    };
    expect((await tool.call(input, scope)).isError).toBeUndefined();
    expect(report?.criteria).toEqual([criterion]);
    expect(report?.verificationObservations).toEqual(observations);
    expect(
      (await tool.call({ ...input, criteria: [{ ...criterion, met: true }] }, scope)).isError,
    ).toBe(true);
  });

  it('preserves executable acceptance checks and rejects malformed plans', async () => {
    let got: SubmitResultArgs | undefined;
    const tool = submitResultTool(async (args) => {
      got = args;
      return { text: 'ok' };
    });
    const args = {
      summary: 'accepted',
      commit_message: 'feat: change',
      criteria: [{ number: 1, met: true, evidence: 'actual build' }],
      verification: [{ name: 'build and affected tests', run: 'pnpm build && pnpm test affected' }],
    };
    expect((await tool.call(args, scope)).isError).toBeUndefined();
    expect(got?.verification).toEqual(args.verification);
    expect(
      (await tool.call({ ...args, verification: [{ name: 'build', run: ' ' }] }, scope)).isError,
    ).toBe(true);
  });
});

it('only the integration scope can pass a structured verification plan', async () => {
  const integration = { ...scope, kind: 'integration' as const, integrationId: 'candidate' };
  let runs = 0;
  const tool = verifyIntegrationTool(async (checks) => {
    runs++;
    return { text: checks[0]!.run };
  });
  expect(tool.available?.(scope)).toBe(false);
  expect(tool.available?.(integration)).toBe(true);
  expect((await tool.call({ checks: [{ name: 'build', run: 'pnpm build' }] }, scope)).isError).toBe(
    true,
  );
  expect((await tool.call({ checks: [] }, integration)).isError).toBe(true);
  expect(await tool.call({ checks: [{ name: 'build', run: 'pnpm build' }] }, integration)).toEqual({
    text: 'pnpm build',
  });
  expect(runs).toBe(1);
});
