import { release } from 'node:os';
import { cleanCommandEnvironment } from '../tools/command-env.ts';
import { fingerprint, hashFile } from './inputs.ts';
import type { BuiltinVerificationDependency } from '@skaro/timeline';
import { captureDependencies } from './dependencies.ts';
import type { RuntimeJournal } from '../journal.ts';

export function captureVerificationEnvironment(journal: RuntimeJournal, signal: AbortSignal) {
  return captureCheckEnvironment(signal, journal.state.config!.tools?.verificationDependencies);
}

/** Measured host/child environment only; never attest unknown command dependencies. */
export async function captureCheckEnvironment(
  signal: AbortSignal,
  dependencies?: readonly BuiltinVerificationDependency[],
) {
  return {
    schema: 1 as const,
    platform: process.platform,
    os: release(),
    node: process.version,
    executableHash: await hashFile(process.execPath, signal),
    inheritedEnv: 'system-allowlist' as const,
    inheritedEnvHash: fingerprint(cleanCommandEnvironment()),
    ...(dependencies ? { dependencies: await captureDependencies(dependencies, signal) } : {}),
    unresolved: [
      'ignored files and installed dependencies',
      'external services and mutable environment',
      'command toolchain resolution and binaries',
    ],
  };
}
