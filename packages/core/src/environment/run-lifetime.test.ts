import { expect, it } from 'vitest';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import { runShell } from './run.ts';

// Finite fallback prevents a failing teardown assertion from leaving an endless test process.
const command = 'node -e "setTimeout(() => console.log(\'SKARO_LIFETIME_NATURAL_EXIT\'), 10000)"';

it('stops the actual owned process tree when an explicit command deadline expires', async () => {
  let pid: number | undefined;
  let output = '';
  await expect(
    runShell(command, {
      cwd: process.cwd(),
      timeoutMs: 100,
      output: (text) => {
        output = text;
      },
      processStarted: (value) => {
        pid = value;
      },
    }),
  ).rejects.toThrow('Shell deadline exceeded');
  expect(pid).toBeDefined();
  expect(output).not.toContain('SKARO_LIFETIME_NATURAL_EXIT');
  expect(await processBirth(pid!)).toBeUndefined();
}, 30000);

it('preserves Stop and verified teardown for a command without an imposed wall-clock deadline', async () => {
  const controller = new AbortController();
  let pid: number | undefined;
  let output = '';
  await expect(
    runShell(command, {
      cwd: process.cwd(),
      signal: controller.signal,
      output: (text) => {
        output = text;
      },
      processStarted: (value) => {
        pid = value;
        controller.abort();
      },
    }),
  ).rejects.toThrow('Shell operation cancelled');
  expect(pid).toBeDefined();
  expect(output).not.toContain('SKARO_LIFETIME_NATURAL_EXIT');
  expect(await processBirth(pid!)).toBeUndefined();
}, 30000);
