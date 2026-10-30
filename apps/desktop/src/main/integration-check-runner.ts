import { git, runShell, type ProjectCheck } from '@skaro/core';
import type { IntegrationOperation } from './integration-model';
import type { IntegrationDeps } from './integration-service';
import { checkItem } from './integration-check-feed';

/** Execute and retain evidence for real checks on the immutable integration candidate. */
export async function runIntegrationChecks(
  op: IntegrationOperation,
  plan: ProjectCheck[],
  env: Record<string, string>,
  cancellation: AbortController,
  deps: IntegrationDeps,
  save: (op: IntegrationOperation) => void,
): Promise<void> {
  op.checkRuns ??= [];
  for (const check of plan) {
    const evidence: NonNullable<IntegrationOperation['checkRuns']>[number] = {
      ...check,
      head: op.head,
      state: 'running',
    };
    op.checkRuns.push(evidence);
    save(op);
    const index = op.checkRuns.length - 1;
    const startedAt = Date.now();
    // The feed shows each check as it runs; a failed write never decides the verification.
    const show = (item = checkItem(op, evidence, index, startedAt)) =>
      deps.checkChanged?.(op, item);
    show();
    let lastOutputSave = 0;
    const timeout = setTimeout(() => {
      void (deps.stopProcesses?.(op) ?? Promise.resolve())
        .finally(() => cancellation.abort())
        .catch(() => undefined);
    }, 30 * 60_000);
    try {
      await runShell(check.run, {
        cwd: op.worktree,
        env,
        label: check.name,
        shell: check.shell,
        signal: cancellation.signal,
        processStarted: (pid) => deps.processStarted?.(op, pid),
        output: (text) => {
          evidence.output = text;
          if (Date.now() - lastOutputSave >= 250) {
            lastOutputSave = Date.now();
            save(op);
            show();
          }
        },
      });
      evidence.state = 'passed';
      save(op);
      show(checkItem(op, evidence, index, startedAt, Date.now()));
    } catch (error) {
      evidence.state = 'failed';
      evidence.error = error instanceof Error ? error.message : String(error);
      save(op);
      const item = checkItem(op, evidence, index, startedAt, Date.now());
      show(cancellation.signal.aborted ? { ...item, status: 'interrupted' } : item);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (
      (await git(op.worktree, ['rev-parse', 'HEAD']).then((result) => result.stdout.trim())) !==
        op.head ||
      (await git(op.worktree, ['status', '--porcelain', '--untracked-files=no'])).stdout.trim()
    )
      throw new Error('Verification changed the candidate; resolve and verify its new version.');
  }
}
