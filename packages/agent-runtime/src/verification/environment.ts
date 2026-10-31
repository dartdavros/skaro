import { release } from 'node:os';
import { cleanCommandEnvironment } from '../tools/command-env.ts';
import { fingerprint, hashFile } from './inputs.ts';

/** Measured host/child environment only; never attest unknown command dependencies. */
export async function captureCheckEnvironment(signal: AbortSignal) {
  return {
    schema: 1 as const,
    platform: process.platform,
    os: release(),
    node: process.version,
    executableHash: await hashFile(process.execPath, signal),
    inheritedEnv: 'system-allowlist' as const,
    inheritedEnvHash: fingerprint(cleanCommandEnvironment()),
    unresolved: [
      'ignored files and installed dependencies',
      'external services and mutable environment',
      'command toolchain resolution and binaries',
    ],
  };
}
