import { runShell, type ProjectCheck } from '@skaro/core';

/** Executes the owner's configured commands in order on the isolated merge candidate. */
export async function runChecks(checkout: string, checks: readonly ProjectCheck[]): Promise<void> {
  for (const check of checks) await runShell(check.run, { cwd: checkout, label: check.name });
}
