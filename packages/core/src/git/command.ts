import { execFile } from 'node:child_process';

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class GitError extends Error {
  readonly args: string[];
  readonly code: number;
  readonly stderr: string;

  constructor(args: string[], result: GitResult) {
    super(
      `git ${args.join(' ')} failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
    this.args = args;
    this.code = result.code;
    this.stderr = result.stderr;
  }
}

/** Runs git in cwd. Non-zero exit throws unless allowFail is set. */
export function git(
  cwd: string,
  args: string[],
  options: { allowFail?: boolean; env?: Record<string, string> } = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        const result = { stdout: String(stdout), stderr: String(stderr), code };
        if (code !== 0 && !options.allowFail) reject(new GitError(args, result));
        else resolve(result);
      },
    );
  });
}
