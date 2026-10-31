import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RuntimeJournal } from '../journal.ts';
import type { PathScope } from '../tools/path-scope.ts';
import type { ExtensionRegistry } from '../extensions/registry.ts';
import { captureCheckInputs, fingerprint, hashFile } from './inputs.ts';
import { captureCheckEnvironment } from './environment.ts';
import type { BrowserEvidence } from './evidence.ts';
import { verifyEvidenceArtifact } from './artifacts.ts';
import { UnknownToolOutcome } from '../tools/effect-error.ts';

/** Provenance for a host-selected real browser call; reported text is not a criterion verdict. */
export async function observeBrowser(
  id: string,
  name: string,
  args: Record<string, unknown>,
  scope: PathScope,
  extensions: ExtensionRegistry,
  journal: RuntimeJournal,
  signal: AbortSignal,
) {
  const policy = extensions.observation(name)!;
  const inputs = await captureCheckInputs(scope, signal);
  const environment = await captureCheckEnvironment(signal);
  const startedAt = Date.now();
  const source = { name, revision: policy.revision, argsHash: fingerprint(args) };
  await journal.append(`observation:${id}:started`, [], {
    value: { kind: 'browser-start', schema: 1, source, inputs, environment, startedAt },
  });
  const directory = journal.state.config!.tools!.artifactDir;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const result = await extensions.invoke(id, name, args, signal);
  try {
    if (
      !result ||
      typeof result !== 'object' ||
      typeof (result as { text?: unknown }).text !== 'string'
    )
      throw new Error('Unsupported observation result');
    const value = result as {
      text: string;
      isError?: boolean;
      artifacts?: BrowserEvidence['artifacts'];
    };
    const artifacts = value.artifacts ?? [];
    for (const artifact of artifacts) await verifyEvidenceArtifact(directory, artifact, signal);
    const after = await captureCheckInputs(scope, signal);
    const afterEnvironment = await captureCheckEnvironment(signal);
    const path = join(directory, `${id}.observation.json`);
    const bytes = Buffer.from(JSON.stringify(result));
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600, signal });
    const evidence: BrowserEvidence = {
      kind: 'browser-observation',
      schema: 1,
      id,
      name,
      criteria: [...policy.criteria],
      cwd: scope.root,
      inputs,
      after,
      environment,
      afterEnvironment,
      startedAt,
      finishedAt: Date.now(),
      source,
      artifacts,
      output: { path, bytes: bytes.length, sha256: await hashFile(path, signal) },
      outcome:
        fingerprint(inputs) !== fingerprint(after)
          ? 'inputs-changed'
          : fingerprint(environment) !== fingerprint(afterEnvironment)
            ? 'environment-changed'
            : value.isError
              ? 'tool-error'
              : 'observed',
    };
    const record = await journal.append(`observation:${id}:result`, [], { value: evidence });
    return {
      ...value,
      evidence: { sequence: record.sequence, hash: record.hash },
      acceptance: 'requires-environment-and-criteria-review',
    };
  } catch (error) {
    if (error instanceof UnknownToolOutcome) throw error;
    throw new UnknownToolOutcome(
      'Browser result could not be recorded/validated; automatic replay forbidden',
    );
  }
}
