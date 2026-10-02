import { spawn } from 'node:child_process';
import type { ProjectCheck } from '@skaro/core';

const OUTPUT_LIMIT = 16_384;

/** Executes the owner's configured commands in order on the isolated merge candidate. */
export async function runChecks(checkout: string, checks: readonly ProjectCheck[]): Promise<void> {
  for (const check of checks) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(check.run, {
        cwd: checkout,
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      const append = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-OUTPUT_LIMIT);
      };
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      child.once('error', (error) => reject(new Error(`${check.name}: ${error.message}`)));
      child.once('close', (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`${check.name}: ${signal ?? `exit ${code}`}\n${output.trim()}`));
      });
    });
  }
}
