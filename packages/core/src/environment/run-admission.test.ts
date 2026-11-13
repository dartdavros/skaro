import { realpath } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { runShell } from './run.ts';

it('finishes actual read-only Git checks before returning their resource capacity', async () => {
  const cwd = await realpath(process.cwd());
  let output = '';
  await runShell('git --version', {
    cwd,
    output: (value) => {
      output = value;
    },
  });
  expect(output).toContain('git version');
  await expect(
    runShell('git rev-parse --verify refs/skaro-rc2-no-such-ref', { cwd }),
  ).rejects.toThrow('exit');
});

it('rejects an already stopped shell operation before spawning its command', async () => {
  const controller = new AbortController();
  controller.abort(new Error('Stopped before dispatch'));
  await expect(
    runShell('git --version', { cwd: await realpath(process.cwd()), signal: controller.signal }),
  ).rejects.toThrow('Stopped before dispatch');
});
