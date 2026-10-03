import { spawn } from 'node:child_process';

const OUTPUT_LIMIT = 16_384;

/** Runs the owner's command in a shell; a failure carries the end of its output. */
export function runShell(
  command: string,
  options: { cwd: string; env?: Record<string, string>; label?: string; timeoutMs?: number },
): Promise<void> {
  const label = options.label ? `${options.label}: ` : '';
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, {
      cwd: options.cwd,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
      ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
    });
    let output = '';
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-OUTPUT_LIMIT);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', (error) => reject(new Error(`${label}${error.message}`)));
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label}${signal ?? `exit ${code}`}\n${output.trim()}`));
    });
  });
}

/** Waits until the address answers 2xx: the services run and their dependencies answer. */
export async function waitReady(
  url: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 180_000);
  for (;;) {
    let last: string;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() >= deadline) throw new Error(`The environment is not ready at ${url}: ${last}`);
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 2_000));
  }
}
