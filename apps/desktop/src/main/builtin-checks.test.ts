import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { it, expect } from 'vitest';
import { RuntimeSession } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import { longContextConfig } from './credentials/long-context-config';
import { approvedTool } from './verification/extension-session';

it.skipIf(process.platform !== 'win32')(
  'records a real repository check, verifies hashes and deduplicates execution',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skaro-real-check-'));
    const config = longContextConfig(directory);
    config.sessionId = 'real-check';
    config.context = undefined;
    config.tools!.readOnly = false;
    config.tools!.commandEntry = resolve('apps/desktop/out/main/agent-command-worker.js');
    config.tools!.verificationDependencies = [
      { id: 'runtime', path: await realpath(process.execPath) },
    ];
    const owner = {
      pid: process.pid,
      birth: (await processBirth(process.pid))!,
      platform: process.platform,
    };
    const readonly = structuredClone(config);
    readonly.sessionId = 'readonly-check';
    readonly.journalPath = join(directory, 'readonly.jsonl');
    readonly.tools!.readOnly = true;
    const blocked = await RuntimeSession.open(readonly, owner);
    try {
      const result = await blocked.execute({
        id: 'forbidden',
        action: {
          type: 'tool',
          name: 'run_check',
          args: { name: 'Forbidden command', criteria: ['scope'], command: 'git diff --check' },
        },
      });
      expect(result.result.error).toContain('Read-only');
      expect(blocked.journal.state.effects.forbidden).toBeUndefined();
    } finally {
      await blocked.dispose();
    }
    const session = await RuntimeSession.open(config, {
      pid: process.pid,
      birth: (await processBirth(process.pid))!,
      platform: process.platform,
    });
    const args = {
      name: 'Whitespace integrity',
      criteria: ['BA-6 real executor and provenance'],
      command: 'git diff --check',
    };
    try {
      const value = (await approvedTool(session, 'real-check', 'run_check', args)) as unknown as {
        evidence: { sequence: number; hash: string };
        outcome: string;
      };
      expect(value.outcome).toBe('passed');
      expect(session.journal.find('check:real-check:result')!.result.value).toMatchObject({
        environment: {
          dependencies: { coverage: 'declared-files-only', files: [{ id: 'runtime' }] },
        },
      });
      const valid = await session.execute({
        id: 'validate',
        action: { type: 'tool', name: 'check_evidence', args: value.evidence },
      });
      expect(valid.result.value).toMatchObject({
        inputsCurrent: true,
        outputCurrent: true,
        environmentCurrent: true,
        acceptance: 'requires-environment-and-criteria-review',
      });
      const previousLanguage = process.env.LANG;
      try {
        process.env.LANG = previousLanguage === 'C' ? 'POSIX' : 'C';
        const changedEnvironment = await session.execute({
          id: 'environment-change',
          action: { type: 'tool', name: 'check_evidence', args: value.evidence },
        });
        expect(changedEnvironment.result.value).toMatchObject({
          inputsCurrent: true,
          environmentCurrent: false,
          outputCurrent: true,
        });
      } finally {
        if (previousLanguage === undefined) delete process.env.LANG;
        else process.env.LANG = previousLanguage;
      }
      const count = session.journal.records.length;
      const replay = await session.execute({
        id: 'real-check',
        action: { type: 'tool', name: 'run_check', args },
      });
      expect(replay.result.value).toEqual(value);
      expect(session.journal.records).toHaveLength(count);
      const page = await session.execute({
        id: 'output-page',
        action: { type: 'tool', name: 'write_stdin', args: { processId: 'real-check', offset: 0 } },
      });
      expect(page.result.value).toMatchObject({
        processId: 'real-check',
        state: 'exited',
        exitCode: 0,
      });
      const forged = await session.execute({
        id: 'forged',
        action: {
          type: 'tool',
          name: 'check_evidence',
          args: { ...value.evidence, hash: '0'.repeat(64) },
        },
      });
      expect(forged.result.error).toContain('Unknown verification');
      const output = (
        session.journal.find('check:real-check:result')!.result.value as {
          output: { path: string };
        }
      ).output;
      // Remove the real generated output; a reference alone must not validate missing evidence.
      await rm(output.path);
      const missing = await session.execute({
        id: 'missing',
        action: { type: 'tool', name: 'check_evidence', args: value.evidence },
      });
      expect(missing.result.value).toMatchObject({ outputCurrent: false });

      // A genuine comparison of the two distinct scoped instruction files returns exit 1.
      // No project/API is fabricated and no failure is planted in the source.
      const comparison = {
        name: 'Compare scoped instructions',
        criteria: ['instructions-differ'],
        command: 'git diff --exit-code --no-index -- AGENTS.md apps/desktop/AGENTS.md',
      };
      const failure = (await approvedTool(
        session,
        'comparison',
        'run_check',
        comparison,
      )) as unknown as typeof value;
      expect(failure.outcome).toBe('failed');
      await expect(
        approvedTool(session, 'no-diagnosis', 'run_check', {
          ...comparison,
          retryOf: failure.evidence,
        }),
      ).rejects.toThrow('recorded diagnosis');
      expect(session.journal.state.processes['no-diagnosis']).toBeUndefined();
      const diagnosis = await session.execute({
        id: 'diagnose',
        action: {
          type: 'tool',
          name: 'diagnose_check',
          args: {
            evidence: failure.evidence,
            category: 'command',
            reason: 'These real scoped instruction files are different by design.',
            correction: 'Keep the failure visible; equality is not a valid acceptance requirement.',
          },
        },
      });
      expect(diagnosis.result.error).toBeUndefined();
      await expect(
        approvedTool(session, 'weakened', 'run_check', {
          ...comparison,
          command: 'git diff --check',
          retryOf: failure.evidence,
        }),
      ).rejects.toThrow('preserve command');
      expect(session.journal.state.processes.weakened).toBeUndefined();
      await expect(
        approvedTool(session, 'weakened-timeout', 'run_check', {
          ...comparison,
          timeoutMs: 120001,
          retryOf: failure.evidence,
        }),
      ).rejects.toThrow('preserve command');
      expect(session.journal.state.processes['weakened-timeout']).toBeUndefined();
      const retried = (await approvedTool(session, 'comparison-again', 'run_check', {
        ...comparison,
        retryOf: failure.evidence,
      })) as unknown as typeof value;
      expect(retried.outcome).toBe('failed');
      expect(session.journal.find('check:comparison:result')!.result.value).toMatchObject({
        outcome: 'failed',
      });
      expect(session.journal.find('check:comparison-again:result')!.result.value).toMatchObject({
        retryOf: failure.evidence,
        outcome: 'failed',
      });
    } finally {
      await session.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
  180_000,
);
