import { join } from 'node:path';
import { release } from 'node:os';
import { lstat } from 'node:fs/promises';
import type { RuntimeJournal } from '../journal.ts';
import type { PathScope } from '../tools/path-scope.ts';
import type { ToolProcesses } from '../tools/processes.ts';
import { schemas } from '../tools/schemas.ts';
import { captureCheckInputs, fingerprint, hashFile, type CheckInputs } from './inputs.ts';

interface CheckEvidence {
  kind: 'command-check';
  schema: 1;
  id: string;
  name: string;
  criteria: string[];
  command: string;
  cwd: string;
  shell: string;
  inputs: CheckInputs;
  after: CheckInputs;
  environment: {
    platform: string;
    os: string;
    node: string;
    executableHash: string;
    inheritedEnv: 'system-allowlist';
    unresolved: string[];
  };
  startedAt: number;
  finishedAt: number;
  outcome: 'passed' | 'failed' | 'infrastructure-error' | 'inputs-changed';
  exitCode: number | null;
  output: { path: string; sha256: string; bytes: number };
}

export async function runCheck(
  id: string,
  raw: unknown,
  scope: PathScope,
  processes: ToolProcesses,
  journal: RuntimeJournal,
  signal: AbortSignal,
) {
  const input = schemas.run_check.parse(raw);
  const cwd = await scope.path(input.cwd ?? '.');
  const inputs = await captureCheckInputs(scope, signal);
  const environment = {
    platform: process.platform,
    os: release(),
    node: process.version,
    executableHash: await hashFile(process.execPath, signal),
    inheritedEnv: 'system-allowlist' as const,
    unresolved: [
      'ignored files and installed dependencies',
      'external services and mutable environment',
      'command toolchain resolution and binaries',
    ],
  };
  const startedAt = Date.now();
  await journal.append(`check:${id}:started`, [], {
    value: { kind: 'check-start', input, cwd, inputs, environment, startedAt },
  });
  let result = await processes.exec(id, { ...input, yieldMs: 1000 }, cwd, signal);
  while (result.state === 'running' || result.state === 'stopping')
    result = await processes.stdin({ processId: id, end: false, offset: 0, yieldMs: 1000 }, signal);
  const after = await captureCheckInputs(scope, signal);
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
    inputs,
    after,
    environment,
    startedAt,
    finishedAt: Date.now(),
    exitCode: result.exitCode,
    outcome:
      fingerprint(inputs) !== fingerprint(after)
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
  const record = journal.records[input.sequence - 1];
  if (
    !record ||
    record.hash !== input.hash ||
    !record.id.startsWith('check:') ||
    !record.id.endsWith(':result')
  )
    throw new Error('Unknown verification evidence reference');
  const value = record.result.value as CheckEvidence;
  if (value?.kind !== 'command-check' || value.schema !== 1)
    throw new Error('Unsupported verification evidence');
  const current = await captureCheckInputs(scope, signal);
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
    outcome: value.outcome,
    criteria: value.criteria,
    acceptance: 'requires-environment-and-criteria-review',
    unresolved: value.environment.unresolved,
  };
}
