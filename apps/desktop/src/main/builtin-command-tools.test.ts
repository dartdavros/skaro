import { afterEach, expect, it } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { startToolSession, type ToolSession } from './builtin-tools-support';
import { processBirth } from '@skaro/agent-runtime/process-identity';

const sessions: ToolSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
}, 60_000);
// Real shell/process scenarios in their own actual runtime workspaces. No server or API substitute.
it('waits for exact command approval and durably deduplicates the executed effect', async () => {
  const check = await startToolSession('auto');
  sessions.push(check);
  const args = {
    command:
      "[IO.File]::AppendAllText('approved.txt', 'once'); [IO.File]::WriteAllText('../outside.txt','D-28 probe')",
    yieldMs: 1000,
  };
  const pending = check.tool('exec_command', args, 'approved');
  await expect
    .poll(() =>
      check.events.find(
        (event) => event.t === 'interaction.opened' && event.interaction.id === 'approval-approved',
      ),
    )
    .toBeDefined();
  await expect(stat(join(check.workspace, 'approved.txt'))).rejects.toThrow();
  await check.session.respond('approval-approved', { kind: 'approval', choice: 'allow_once' });
  const first = await pending;
  expect(await check.tool('exec_command', args, 'approved')).toEqual(first);
  expect(await readFile(join(check.workspace, 'approved.txt'), 'utf8')).toBe('once');
  // This real write establishes that the Job Object is not a filesystem sandbox.
  expect(await readFile(join(check.directory, 'outside.txt'), 'utf8')).toBe('D-28 probe');
}, 60_000);

it('handles real stdin, paged long output, timeout and clean command environment', async () => {
  const check = await startToolSession();
  sessions.push(check);
  const echo = await check.tool('exec_command', {
    command:
      'node -e "process.stdin.once(\'data\',x=>process.stdout.write(x,()=>process.exit(0)))"',
    shell: 'cmd',
    yieldMs: 0,
  });
  let answer = await check.tool('write_stdin', {
    processId: echo.processId,
    chars: 'Actual stdin\n',
    end: true,
    yieldMs: 1000,
  });
  await expect
    .poll(
      async () => {
        answer = await check.tool('write_stdin', { processId: echo.processId, yieldMs: 50 });
        return answer.state;
      },
      { timeout: 15_000 },
    )
    .toBe('exited');
  expect(answer).toMatchObject({ error: null, exitCode: 0 });
  expect(String(answer.output)).toContain('Actual stdin');
  const output = await check.tool('exec_command', {
    command: 'node -e "process.stdout.write(\'x\'.repeat(100000))"',
    shell: 'cmd',
    yieldMs: 1000,
  });
  let current = output;
  await expect
    .poll(
      async () => {
        current = await check.tool('write_stdin', { processId: output.processId, yieldMs: 50 });
        return current.state;
      },
      { timeout: 15_000 },
    )
    .toBe('exited');
  expect(current.availableBytes).toBe(100000);
  expect(String(current.output)).toHaveLength(16384);
  const next = await check.tool('write_stdin', {
    processId: output.processId,
    offset: 16384,
    yieldMs: 0,
  });
  expect(next.offset).toBe(16384);
  expect(String(next.output)).toHaveLength(16384);
  const environment = await check.tool('exec_command', {
    command: 'node -e "process.stdout.write(Object.keys(process.env).join(\',\'))"',
    shell: 'cmd',
    yieldMs: 1000,
  });
  expect(String(environment.output)).not.toMatch(
    /OPENAI|ANTHROPIC|DEEPSEEK|OPENROUTER|CODEX_|CLAUDE_|SKARO_COMMAND_|ELECTRON_RUN_AS_NODE/i,
  );
  const timeout = await check.tool('exec_command', {
    command: 'Start-Sleep -Seconds 60',
    timeoutMs: 500,
    yieldMs: 1000,
  });
  let timed = timeout;
  await expect
    .poll(
      async () => {
        timed = await check.tool('write_stdin', { processId: timeout.processId, yieldMs: 50 });
        return timed.state;
      },
      { timeout: 15_000 },
    )
    .toBe('exited');
  expect(timed.error).toBe('Command timed out');
}, 90_000);

it('interrupts a real background tree and confirms the child OS process exited', async () => {
  const check = await startToolSession();
  sessions.push(check);
  const command =
    "$child = Start-Process node -ArgumentList '-e', 'setInterval(()=>{},1000)' -PassThru -NoNewWindow; Write-Output $child.Id; Start-Sleep -Seconds 60";
  const result = await check.tool('exec_command', { command, yieldMs: 1000 });
  let output = result;
  await expect
    .poll(
      async () => {
        output = await check.tool('write_stdin', { processId: result.processId, yieldMs: 50 });
        return String(output.output).trim();
      },
      { timeout: 15_000 },
    )
    .toMatch(/^\d+$/);
  const pid = Number(String(output.output).trim());
  expect(await processBirth(pid)).toBeTruthy();
  await check.session.interrupt();
  expect(await processBirth(pid)).toBeUndefined();
  await expect(
    check.tool('exec_command', { command: "[IO.File]::WriteAllText('late.txt','bad')" }),
  ).rejects.toThrow('revoked');
  await expect(stat(join(check.workspace, 'late.txt'))).rejects.toThrow();
}, 60_000);

it('recovers retained command output after a genuine runtime crash without replaying its effect', async () => {
  const check = await startToolSession();
  sessions.push(check);
  const args = { command: "Write-Output 'retained'; Start-Sleep -Seconds 60", yieldMs: 1000 };
  const first = await check.tool('exec_command', args, 'crash-command');
  await expect
    .poll(
      async () =>
        String(
          (await check.tool('write_stdin', { processId: first.processId, yieldMs: 50 })).output,
        ),
      { timeout: 15_000 },
    )
    .toContain('retained');
  await check.restart(true);
  const recovered = await check.tool('write_stdin', { processId: first.processId, yieldMs: 0 });
  expect(recovered).toMatchObject({ state: 'interrupted' });
  expect(String(recovered.error)).toContain('outcome is unknown');
  expect(String(recovered.output)).toContain('retained');
  expect(await check.tool('exec_command', args, 'crash-command')).toEqual(first);
}, 60_000);
