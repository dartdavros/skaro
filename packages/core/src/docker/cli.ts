import { execFile } from 'node:child_process';

/** Runs the Docker CLI; rejects when Docker is absent, stopped or the command fails. */
export function docker(args: string[], options: { timeoutMs?: number } = {}): Promise<string> {
  return new Promise((accept, reject) => {
    execFile(
      'docker',
      args,
      { windowsHide: true, timeout: options.timeoutMs ?? 10_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : accept(stdout)),
    );
  });
}

/** Lines of a `-q` listing. */
export function ids(output: string): string[] {
  return output.trim().split(/\s+/).filter(Boolean);
}
