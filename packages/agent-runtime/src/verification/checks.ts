import { join } from 'node:path';

import { lstat } from 'node:fs/promises';
import type { RuntimeJournal } from '../journal.ts';
import type { PathScope } from '../tools/path-scope.ts';
import type { ToolProcesses } from '../tools/processes.ts';
import { schemas } from '../tools/schemas.ts';
import { captureCheckInputs, fingerprint, hashFile } from './inputs.ts';
import { captureVerificationEnvironment } from './environment.ts';
import { requireEvidence, type CheckEvidence } from './evidence.ts';
import { requireCheckRetry } from './repairs.ts';
import { verifyEvidenceArtifact } from './artifacts.ts';
import { requirePlannedCheck } from './plans.ts';
import type { RuntimeVerificationHost } from './host.ts';

export async function runCheck(
  id: string,
  raw: unknown,
  scope: PathScope,
  processes: ToolProcesses,
  journal: RuntimeJournal,
  signal: AbortSignal,
  verification?: RuntimeVerificationHost,
) {
  const input = schemas.run_check.parse(raw);
  const cwd = await scope.path(input.cwd ?? '.', true);
  await requirePlannedCheck(input, cwd, scope, journal, verification, signal);
  if (verification && !input.plan)
    throw new Error('Bound task checks require an authoritative verification plan');
  requireCheckRetry(input, cwd, journal);
  const inputs = await captureCheckInputs(scope, signal);
  const environment = await captureVerificationEnvironment(journal, signal);
  const startedAt = Date.now();
  await journal.append(`check:${id}:started`, [], {
    value: { kind: 'check-start', input, cwd, inputs, environment, startedAt },
  });
  // Hashing and journal persistence may take time; recheck the live lease at execution.
  await requirePlannedCheck(input, cwd, scope, journal, verification, signal);
  let result = await processes.exec(id, { ...input, yieldMs: 1000 }, cwd, signal);
  while (result.state === 'running' || result.state === 'stopping')
    result = await processes.stdin({ processId: id, end: false, offset: 0, yieldMs: 1000 }, signal);
  const after = await captureCheckInputs(scope, signal);
  const afterEnvironment = await captureVerificationEnvironment(journal, signal);
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
    ...(input.plan ? { plan: input.plan } : {}),
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
  const value = requireEvidence(journal, input);
  const current = await captureCheckInputs(scope, signal);
  const currentEnvironment = await captureVerificationEnvironment(journal, signal);
  let outputCurrent = false;
  let artifactsCurrent = true;
  try {
    await verifyEvidenceArtifact(journal.state.config!.tools!.artifactDir, value.output, signal);
    outputCurrent = true;
  } catch {
    signal.throwIfAborted();
  }
  if (value.kind === 'browser-observation')
    for (const artifact of value.artifacts) {
      try {
        await verifyEvidenceArtifact(journal.state.config!.tools!.artifactDir, artifact, signal);
      } catch {
        signal.throwIfAborted();
        artifactsCurrent = false;
      }
    }
  return {
    inputsCurrent:
      fingerprint(value.inputs) === fingerprint(current) &&
      fingerprint(value.after) === fingerprint(current),
    outputCurrent,
    ...(value.kind === 'browser-observation'
      ? {
          artifactsCurrent,
          sourceCurrent:
            journal.state.effects[value.id]?.state === 'completed' &&
            journal.state.toolRequests[value.id]?.name === value.source.name &&
            journal.state.config!.extensions?.some(
              (tool) => tool.name === value.source.name && tool.revision === value.source.revision,
            ) === true,
          latestObservation: !journal.records
            .slice(input.sequence)
            .some((record) =>
              record.facts.some(
                (fact) => fact.type === 'tool-request' && fact.name.startsWith('mcp__'),
              ),
            ),
        }
      : {}),
    environmentCurrent:
      value.afterEnvironment !== undefined &&
      fingerprint(value.environment) === fingerprint(currentEnvironment) &&
      fingerprint(value.afterEnvironment) === fingerprint(currentEnvironment),
    outcome: value.outcome,
    criteria: value.criteria,
    ...(currentEnvironment.dependencies
      ? {
          dependencyMeasurement: {
            policy: currentEnvironment.dependencies.policy,
            coverage: currentEnvironment.dependencies.coverage,
            files: currentEnvironment.dependencies.files.map(({ id, bytes, sha256 }) => ({
              id,
              bytes,
              sha256,
            })),
          },
        }
      : {}),
    acceptance: 'requires-environment-and-criteria-review',
    unresolved: value.environment.unresolved,
  };
}
