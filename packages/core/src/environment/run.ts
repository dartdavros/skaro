import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { checkCommand, type CheckShell } from './check-command.ts';
import { shellLifetime } from './shell-lifetime.ts';

const OUTPUT_LIMIT = 16_384;

/** Runs the owner's command in a shell; a failure carries the end of its output. */
export function runShell(
  command: string,
  options: {
    cwd: string;
    env?: Record<string, string>;
    label?: string;
    shell?: CheckShell;
    timeoutMs?: number;
    signal?: AbortSignal;
    processStarted?: (pid: number) => void | Promise<void>;
    output?: (text: string) => void;
  },
): Promise<void> {
  const label = options.label ? `${options.label}: ` : '';
  return new Promise<void>((resolve, reject) => {
    options.signal?.throwIfAborted();
    const invocation = checkCommand(command, options.shell);
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      shell: invocation.shell,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
    });
    const lifetime = shellLifetime(child, options.signal, options.timeoutMs);
    let output = '';
    let admitted = Promise.resolve();
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-OUTPUT_LIMIT);
      options.output?.(output);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', (error) => lifetime.failed(new Error(`${label}${error.message}`)));
    child.once('close', (code, signal) => {
      void Promise.all([admitted, lifetime.ended()]).then(() => {
        if (code === 0) resolve();
        else reject(new Error(`${label}${signal ?? `exit ${code}`}\n${output.trim()}`));
      }, reject);
    });
    try {
      if (child.pid) admitted = Promise.resolve(options.processStarted?.(child.pid));
      void admitted.catch((error: unknown) => {
        lifetime.failed(error instanceof Error ? error : new Error(String(error)));
        lifetime.stop();
      });
    } catch (error) {
      lifetime.failed(error instanceof Error ? error : new Error(String(error)));
      lifetime.stop();
    }
  });
}

/** Waits until the address answers 2xx: the services run and their dependencies answer. */
export async function waitReady(
  url: string,
  options: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 180_000);
  for (;;) {
    options.signal?.throwIfAborted();
    let last: string;
    try {
      const timeout = AbortSignal.timeout(5_000);
      const response = await fetch(url, {
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    options.signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new Error(`The environment is not ready at ${url}: ${last}`);
    await delay(options.intervalMs ?? 2_000, undefined, { signal: options.signal });
  }
}
