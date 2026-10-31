import { join } from 'node:path';

import { lstat } from 'node:fs/promises';
import type { RuntimeJournal } from '../journal.ts';
import type { PathScope } from '../tools/path-scope.ts';
import type { ToolProcesses } from '../tools/processes.ts';
import { schemas } from '../tools/schemas.ts';
import { captureCheckInputs, fingerprint, hashFile } from './inputs.ts';
import { captureCheckEnvironment } from './environment.ts';
import { requireCheckEvidence, type CheckEvidence } from './evidence.ts';
import { requireCheckRetry } from './repairs.ts';

export async function runCheck(
  id: string,
  raw: unknown,
  scope: PathScope,
  processes: ToolProcesses,
  journal: RuntimeJournal,
  signal: AbortSignal,
) {
  const input = schemas.run_check.parse(raw);
  const cwd = await scope.path(input.cwd ?? '.', true);
  requireCheckRetry(input, cwd, journal);
  const inputs = await captureCheckInputs(scope, signal);
  const environment = await captureCheckEnvironment(signal);
  const startedAt = Date.now();
  await journal.append(`check:${id}:started`, [], {
    value: { kind: 'check-start', input, cwd, inputs, environment, startedAt },
  });
  let result = await processes.exec(id, { ...input, yieldMs: 1000 }, cwd, signal);
  while (result.state === 'running' || result.state === 'stopping')
    result = await processes.stdin({ processId: id, end: false, offset: 0, yieldMs: 1000 }, signal);
  const after = await captureCheckInputs(scope, signal);
  const afterEnvironment = await captureCheckEnvironment(signal);
  const path = join(journal.state.config!.tools!.artifactDir, `${id}.output`);
  const output = { path, sha256: await hashFile(path, signal), bytes: (await lstat(path)).size };
  const value: CheckEvidence = {
    kind: 'command-check',
    schema: 1,
    id,
    name: input.name,
    criteria: input.criteria,
    command: input.command,
    cwd,
    shell: input.shell ?? 'powershell',
    timeoutMs: input.timeoutMs,
    inputs,
    after,
    environment,
    afterEnvironment,
    ...(input.retryOf ? { retryOf: input.retryOf } : {}),
    startedAt,
    finishedAt: Date.now(),
    exitCode: result.exitCode,
    outcome:
      fingerprint(environment) !== fingerprint(afterEnvironment)
        ? 'environment-changed'
        : fingerprint(inputs) !== fingerprint(after)
          ? 'inputs-changed'
          : result.error
            ? 'infrastructure-error'
            : result.exitCode === 0
              ? 'passed'
              : 'failed',
    output,
  };
  const record = await journal.append(`check:${id}:result`, [], { value });
  return {
    evidence: { sequence: record.sequence, hash: record.hash },
    processId: id,
    outcome: value.outcome,
    exitCode: result.exitCode,
    output,
    acceptance: 'requires-environment-and-criteria-review',
  };
}

export async function checkEvidence(
  raw: unknown,
  scope: PathScope,
  journal: RuntimeJournal,
  signal: AbortSignal,
) {
  const input = schemas.check_evidence.parse(raw);
  const value = requireCheckEvidence(journal, input);
  const current = await captureCheckInputs(scope, signal);
  const currentEnvironment = await captureCheckEnvironment(signal);
  let outputCurrent = false;
  try {
    outputCurrent = (await hashFile(value.output.path, signal)) === value.output.sha256;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    inputsCurrent:
      fingerprint(value.inputs) === fingerprint(current) &&
      fingerprint(value.after) === fingerprint(current),
    outputCurrent,
    environmentCurrent:
      value.afterEnvironment !== undefined &&
      fingerprint(value.environment) === fingerprint(currentEnvironment) &&
      fingerprint(value.afterEnvironment) === fingerprint(currentEnvironment),
    outcome: value.outcome,
    criteria: value.criteria,
    acceptance: 'requires-environment-and-criteria-review',
    unresolved: value.environment.unresolved,
  };
}
