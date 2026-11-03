import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { open, type FileHandle } from 'node:fs/promises';
import { cleanCommandEnvironment } from './command-env.ts';
import type { CommandControl, CommandEvent } from './command-protocol.ts';
import { commandInvocation } from './shell.ts';
import { taskCommandEnvironment } from './task-command-env.ts';

let child: ChildProcessWithoutNullStreams | undefined;
let output: FileHandle | undefined;
let writes = Promise.resolve();
let bytes = 0;
const post = (message: CommandEvent) => process.stdout.write(JSON.stringify(message) + '\n');
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  void (async () => {
    const message = JSON.parse(line) as CommandControl;
    if (message.type === 'run') {
      if (child) throw new Error('Command already launched');
      output = await open(message.outputPath, 'wx', 0o600);
      const invocation = commandInvocation(message.command, message.shell);
      child = spawn(invocation.command, invocation.args, {
        shell: invocation.shell,
        cwd: message.cwd,
        env: { ...cleanCommandEnvironment(), ...taskCommandEnvironment(message.environment) },
        windowsHide: true,
        stdio: 'pipe',
      });
      const append = (chunk: Buffer) => {
        child!.stdout.pause();
        child!.stderr.pause();
        bytes += chunk.length;
        writes = writes
          .then(async () => {
            if (bytes > 64 * 1024 * 1024)
              throw new Error('Command output exceeded the 64 MiB disk limit');
            await output!.writeFile(chunk);
          })
          .then(() => {
            child!.stdout.resume();
            child!.stderr.resume();
          })
          .catch((error: unknown) => {
            post({
              type: 'error',
              error: error instanceof Error ? error.message : 'Output persistence failed',
            });
            child!.kill();
          });
      };
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      child.on('error', (error) => post({ type: 'error', error: error.message }));
      child.on('close', (code, signal) => {
        void writes
          .then(async () => {
            await output!.sync();
            await output!.close();
            output = undefined;
            post({ type: 'exit', code, signal, bytes });
          })
          .catch(() => post({ type: 'error', error: 'Command output could not be finalized' }));
      });
      if (!child.pid) throw new Error('Command process did not start');
      post({ type: 'launched', pid: child.pid });
    } else {
      if (!child || child.exitCode !== null || child.stdin.destroyed)
        throw new Error('Command stdin is closed');
      const callback = (error?: Error | null) =>
        post({ type: 'stdin', id: message.id, ...(error ? { error: error.message } : {}) });
      if (message.end) child.stdin.end(message.chars, callback);
      else child.stdin.write(message.chars, callback);
    }
  })().catch((error: unknown) =>
    post({
      type: 'error',
      error: error instanceof Error ? error.message : 'Invalid command control',
    }),
  );
});
// On Windows EOF releases the Job Object owner. POSIX uses the worker's group.
const terminate = () => {
  if (process.platform !== 'win32') process.kill(-process.pid, 'SIGKILL');
  process.exit(1);
};
input.on('close', terminate);
if (process.platform !== 'win32') {
  process.on('SIGTERM', terminate);
  process.on('SIGINT', terminate);
  process.on('SIGHUP', terminate);
  process.on('uncaughtException', terminate);
  process.on('unhandledRejection', terminate);
}
post({ type: 'ready' });
