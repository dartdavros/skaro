import { describe, expect, it } from 'vitest';
import { submitResultTool, type SubmitResultArgs } from './tools.ts';

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
});
