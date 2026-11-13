import { expect, it } from 'vitest';
import {
  encodeNativeIdentity,
  pnpmTargetMatches,
  sameNativeIdentity,
  sameNativeObservation,
  validExactNativeIdentity,
  type NativeIdentity,
  type PnpmTargetIdentity,
} from './managed-native-identity';

const observed: NativeIdentity = {
  dev: 37n,
  ino: 13229323907920232n,
  birthtimeNs: 1794519347717123456n,
};
const target = (): PnpmTargetIdentity => ({
  path: 'private/node_modules',
  // Compatibility numbers deliberately cannot express the native pin.
  dev: 37,
  ino: 13229323907920232,
  birthtimeMs: 1794519347717.1235,
  nativeIdentity: encodeNativeIdentity(observed),
});

it('roundtrips a native inode beyond MAX_SAFE_INTEGER in JSON without losing a single bit', () => {
  const encoded = encodeNativeIdentity(observed);
  expect(encoded).toEqual({
    version: 'native-bigint-v1',
    dev: '37',
    ino: '13229323907920232',
    birthtimeNs: '1794519347717123456',
  });
  const decoded = JSON.parse(JSON.stringify(target()));
  expect(pnpmTargetMatches(decoded, decoded.path, observed)).toBe(true);
  // Adjacent native inode rounds to the SAME Number: number Stats would authorize a replacement.
  const replaced = { ...observed, ino: observed.ino + 1n };
  expect(Number(replaced.ino)).toBe(Number(observed.ino));
  expect(pnpmTargetMatches(decoded, decoded.path, replaced)).toBe(false);
});

it('pins path, device, inode AND birthtimeNs; never adopts a replacement root', () => {
  const original = target();
  expect(pnpmTargetMatches(original, 'other/node_modules', observed)).toBe(false);
  for (const field of ['dev', 'ino', 'birthtimeNs'] as const) {
    const changed = { ...observed, [field]: observed[field] + 1n };
    expect(sameNativeIdentity(observed, changed)).toBe(false);
    expect(pnpmTargetMatches(original, original.path, changed)).toBe(false);
  }
  // Compatibility fields are explicitly not authority for a tagged native capability.
  expect(
    pnpmTargetMatches({ ...original, dev: 1, ino: 2, birthtimeMs: 3 }, original.path, observed),
  ).toBe(true);
  expect(
    pnpmTargetMatches({ ...original, nativeIdentity: undefined }, original.path, observed),
  ).toBe(false);
});

it('rejects noncanonical, nonpositive, out-of-dimension and unversioned native identities', () => {
  const encoded = encodeNativeIdentity(observed);
  for (const field of ['dev', 'ino', 'birthtimeNs'] as const)
    for (const bad of ['0', '-1', '+1', '01', '1.0', '1e3', ' 1', '1 ', '1\n', '1\r\n', '', 1, 1n, null])
      expect(validExactNativeIdentity({ ...encoded, [field]: bad })).toBe(false);
  for (const changed of [
    { ...encoded, dev: '18446744073709551616' },
    { ...encoded, ino: '18446744073709551616' },
    { ...encoded, birthtimeNs: '9223372036854775808' },
    { ...encoded, version: 'native-bigint-v2' },
    { dev: encoded.dev, ino: encoded.ino, birthtimeNs: encoded.birthtimeNs },
    { ...encoded, birthtimeMs: '1794519347717' },
  ])
    expect(validExactNativeIdentity(changed)).toBe(false);
  expect(
    validExactNativeIdentity({
      version: 'native-bigint-v1',
      dev: '18446744073709551615',
      ino: '18446744073709551615',
      birthtimeNs: '9223372036854775807',
    }),
  ).toBe(true);
  expect(() => encodeNativeIdentity({ ...observed, ino: 0n })).toThrow('identity_unsupported');
  expect(() => encodeNativeIdentity({ ...observed, ino: -1n })).toThrow('identity_unsupported');
});

it('allows legacy authority only for positive safe exact integers that match native units exactly', () => {
  const legacy = { path: 'private/node_modules', dev: 37, ino: 42, birthtimeMs: 1234 };
  const native = { dev: 37n, ino: 42n, birthtimeNs: 1234000000n };
  expect(pnpmTargetMatches(legacy, legacy.path, native)).toBe(true);
  expect(
    pnpmTargetMatches(legacy, legacy.path, { ...native, birthtimeNs: native.birthtimeNs + 1n }),
  ).toBe(false);
  for (const field of ['dev', 'ino', 'birthtimeMs'] as const)
    for (const bad of [Number.MAX_SAFE_INTEGER + 1, 0, -1, 1.25, Infinity, NaN])
      expect(pnpmTargetMatches({ ...legacy, [field]: bad }, legacy.path, native)).toBe(false);
  const unsafe = target();
  delete unsafe.nativeIdentity;
  expect(pnpmTargetMatches(unsafe, unsafe.path, observed)).toBe(false);
});

it('guards per-node observations with exact identity and nanosecond mutation checks', () => {
  const before = { ...observed, size: 11n, mtimeNs: 123456789n, mode: 33188n, nlink: 1n };
  expect(sameNativeObservation(before, { ...before })).toBe(true);
  for (const field of ['dev', 'ino', 'birthtimeNs', 'size', 'mtimeNs', 'mode', 'nlink'] as const)
    expect(sameNativeObservation(before, { ...before, [field]: before[field] + 1n })).toBe(false);
});
