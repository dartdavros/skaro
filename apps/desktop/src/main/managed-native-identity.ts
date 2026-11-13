import type { BigIntStats } from 'node:fs';

/** Versioned native units; JSON contains strings, never BigInt or rounded Stats identifiers. */
export interface ExactNativeIdentity {
  version: 'native-bigint-v1';
  dev: string;
  ino: string;
  birthtimeNs: string;
}
export type NativeIdentity = Pick<BigIntStats, 'dev' | 'ino' | 'birthtimeNs'>;
export interface PnpmTargetIdentity {
  path: string;
  /** Legacy display/structural compatibility only when nativeIdentity is present. */
  dev: number;
  ino: number;
  birthtimeMs: number;
  nativeIdentity?: ExactNativeIdentity;
}
const UINT64_MAX = (1n << 64n) - 1n;
const INT64_MAX = (1n << 63n) - 1n;
function positiveDecimal(value: unknown, maximum: bigint): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    /^[1-9][0-9]{0,19}$/.test(value) &&
    BigInt(value) <= maximum
  );
}
export function validExactNativeIdentity(value: unknown): value is ExactNativeIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    Object.keys(entry).length === 4 &&
    Object.keys(entry).every((key) => ['version', 'dev', 'ino', 'birthtimeNs'].includes(key)) &&
    entry.version === 'native-bigint-v1' &&
    positiveDecimal(entry.dev, UINT64_MAX) &&
    positiveDecimal(entry.ino, UINT64_MAX) &&
    positiveDecimal(entry.birthtimeNs, INT64_MAX)
  );
}
export function encodeNativeIdentity(info: NativeIdentity): ExactNativeIdentity {
  if (![info.dev, info.ino, info.birthtimeNs].every((value) => typeof value === 'bigint'))
    throw new Error('managed_native_identity_unsupported');
  const result: ExactNativeIdentity = {
    version: 'native-bigint-v1',
    dev: info.dev.toString(),
    ino: info.ino.toString(),
    birthtimeNs: info.birthtimeNs.toString(),
  };
  if (!validExactNativeIdentity(result)) throw new Error('managed_native_identity_unsupported');
  return result;
}
export function sameNativeIdentity(a: NativeIdentity, b: NativeIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}
type NativeObservation = NativeIdentity & Pick<BigIntStats, 'size' | 'mtimeNs' | 'mode' | 'nlink'>;
export function sameNativeObservation(a: NativeObservation, b: NativeObservation): boolean {
  return (
    sameNativeIdentity(a, b) &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.mode === b.mode &&
    a.nlink === b.nlink
  );
}
/** Old records stay readable, but rounded/ambiguous numbers can never authorize a target. */
export function pnpmTargetMatches(
  target: PnpmTargetIdentity,
  path: string,
  observed: NativeIdentity,
): boolean {
  if (target.path !== path) return false;
  if ('nativeIdentity' in target) {
    const exact = target.nativeIdentity;
    return (
      validExactNativeIdentity(exact) &&
      sameNativeIdentity(
        { dev: BigInt(exact.dev), ino: BigInt(exact.ino), birthtimeNs: BigInt(exact.birthtimeNs) },
        observed,
      )
    );
  }
  // No inference from unsafe integers, fractional millisecond values, or partially tagged data.
  if (![target.dev, target.ino, target.birthtimeMs].every((n) => Number.isSafeInteger(n) && n > 0))
    return false;
  return sameNativeIdentity(
    {
      dev: BigInt(target.dev),
      ino: BigInt(target.ino),
      birthtimeNs: BigInt(target.birthtimeMs) * 1_000_000n,
    },
    observed,
  );
}
