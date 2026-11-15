import type { RunRecord } from '@skaro/core';
import type { ToolResult } from '@skaro/mcp-server';
import { taskEnvironmentInstructions } from './task-environment-instructions';

/** A saved run owns its isolation; project defaults apply only before a run exists. */
export function taskRunIsolation(
  run: Pick<RunRecord, 'worktree'> | undefined,
  fallback: 'worktree' | 'in-place',
): 'worktree' | 'in-place' {
  return run ? (run.worktree ? 'worktree' : 'in-place') : fallback;
}

/** Guidance only: never allocate, start or claim readiness of shared project services. */
export function inPlaceEnvironmentResult(
  root: string,
  run: Pick<RunRecord, 'worktree'>,
): ToolResult | undefined {
  if (taskRunIsolation(run, 'worktree') !== 'in-place') return undefined;
  return {
    text:
      `This run uses the shared main working copy: ${root}. No separate checkout is required. ` +
      'start_environment and configure_environment manage isolated task copies only. ' +
      'No services were started or checked and no configuration was changed by this call. ' +
      'Do not retry these tools or report a missing task checkout as a blocker for this run.\n\n' +
      taskEnvironmentInstructions('in-place'),
    structuredContent: { mode: 'in-place', cwd: root, readiness: 'not_checked' },
  };
}
