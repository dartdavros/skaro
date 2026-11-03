import { afterEach, expect, it } from 'vitest';
import { startToolSession, type ToolSession } from './builtin-tools-support';

const posixIt = it.skipIf(!['linux', 'darwin'].includes(process.platform));
const sessions: ToolSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
}, 60_000);

// Real platform processes only. Windows-specific Job Object probes stay in their own suite.
posixIt(
  'delivers actual stdin through sh and confirms timeout cleanup through bash',
  async () => {
    const current = await startToolSession();
    sessions.push(current);
    const first = await current.tool('exec_command', {
      command:
        'node -e "process.stdin.once(\'data\',x=>process.stdout.write(x,()=>process.exit(0)))"',
      shell: 'sh',
      yieldMs: 0,
    });
    await current.tool('write_stdin', {
      processId: first.processId,
      chars: 'actual stdin\n',
      end: true,
      yieldMs: 100,
    });
    let result = first;
    await expect
      .poll(
        async () => {
          result = await current.tool('write_stdin', { processId: first.processId, yieldMs: 50 });
          return result.state;
        },
        { timeout: 15_000 },
      )
      .toBe('exited');
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('actual stdin\n');
    const timed = await current.tool('exec_command', {
      command: 'sleep 60',
      shell: 'bash',
      timeoutMs: 500,
      yieldMs: 1000,
    });
    await expect
      .poll(
        async () => {
          result = await current.tool('write_stdin', { processId: timed.processId, yieldMs: 50 });
          return result.state;
        },
        { timeout: 15_000 },
      )
      .toBe('exited');
    expect(result.error).toBe('Command timed out');
  },
  60_000,
);

posixIt(
  'retains real output after runtime loss and never replays the command',
  async () => {
    const current = await startToolSession();
    sessions.push(current);
    const args = { command: 'printf retained; sleep 60', shell: 'sh', yieldMs: 1000 };
    const first = await current.tool('exec_command', args, 'posix-crash');
    await expect
      .poll(
        async () =>
          (await current.tool('write_stdin', { processId: first.processId, yieldMs: 50 })).output,
        { timeout: 15_000 },
      )
      .toContain('retained');
    await current.restart(true);
    const recovered = await current.tool('write_stdin', { processId: first.processId, yieldMs: 0 });
    expect(recovered.state).toBe('interrupted');
    expect(recovered.output).toContain('retained');
    expect(await current.tool('exec_command', args, 'posix-crash')).toEqual(first);
  },
  60_000,
);
