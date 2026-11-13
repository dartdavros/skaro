export type PnpmCommandPhase = 'fetch' | 'install' | 'version' | 'command';

const runtimeCodes = new Set([
  'ENOENT',
  'EACCES',
  'EPERM',
  'ENAMETOOLONG',
  'ENOSPC',
  'EMFILE',
  'ENFILE',
  'EEXIST',
  'EXDEV',
  'EIO',
  'EINVAL',
  'MODULE_NOT_FOUND',
  'ERR_WORKER_INIT_FAILED',
  'ERR_WORKER_OUT_OF_MEMORY',
  'ERR_WORKER_UNSUPPORTED_OPERATION',
  'ERR_INVALID_ARG_TYPE',
  'ERR_INVALID_ARG_VALUE',
  'ERR_OUT_OF_RANGE',
]);

/** Only bounded protocol identifiers leave ephemeral buffers; never raw messages, flags or paths. */
export function pnpmDiagnosticCode(...streams: string[]): string | undefined {
  for (const stream of streams) {
    if (stream.length > 1024 * 1024) continue;
    // pnpm's early errorHandler emits pretty JSON {error:{code}}, not reporter NDJSON {err:{code}}.
    for (const line of [stream, ...stream.split('\n')]) {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const record = value as { err?: unknown; error?: unknown };
      const err = record.err ?? record.error;
      if (!err || typeof err !== 'object' || Array.isArray(err)) continue;
      const code = (err as { code?: unknown }).code;
      if (
        typeof code === 'string' &&
        (/^ERR_PNPM_[A-Z0-9_]{1,80}$/.test(code) || runtimeCodes.has(code))
      )
        return code;
    }
  }
  return undefined;
}
export function pnpmCommandPhase(args: readonly string[]): PnpmCommandPhase {
  if (args.length === 2 && args[1] === '--version') return 'version';
  if (args[3] === 'fetch' || args[3] === 'install') return args[3];
  return 'command';
}
export function pnpmCommandFailure(
  phase: PnpmCommandPhase,
  exitCode: number | null,
  stdout: string,
  stderr: string,
): Error {
  const code = pnpmDiagnosticCode(stdout, stderr) ?? 'unreported';
  const exit =
    Number.isInteger(exitCode) && Math.abs(exitCode!) <= 0xffffffff ? String(exitCode) : 'unknown';
  return new Error(`managed_pnpm_${phase}_failed_exit_${exit}_${code}`);
}
