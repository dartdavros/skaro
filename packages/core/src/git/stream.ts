import { spawn } from 'node:child_process';
import { GitError } from './command.ts';

/** Consume real Git output incrementally; diff size must not change its fingerprint. */
export async function gitStream(
  cwd: string,
  args: string[],
  consume: (text: string) => void,
  options: { input?: string | Buffer; env?: Record<string, string> } = {},
): Promise<void> {
  const child = spawn('git', args, {
    cwd,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const completion = new Promise<{ code: number; error?: Error }>((resolve) => {
    child.once('error', (error) => resolve({ code: 1, error }));
    child.once('close', (code) => resolve({ code: code ?? 1 }));
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-8192);
  });
  child.stdin.on('error', () => undefined);
  child.stdin.end(options.input);
  try {
    child.stdout.setEncoding('utf8');
    for await (const chunk of child.stdout) consume(String(chunk));
  } catch (error) {
    child.kill();
    await completion;
    throw error;
  }
  const outcome = await completion;
  if (outcome.code !== 0)
    throw new GitError(args, { code: outcome.code, stdout: '', stderr }, outcome.error);
}
