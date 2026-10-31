import { expect, it } from 'vitest';
import {
  BUILTIN_CONTRACT_VERSIONS,
  builtinAgentReady,
  requireBuiltinCompatibility,
} from '@skaro/timeline';

it('requires both an available runtime and configured route, without subscription/install states', () => {
  const runtime = { state: 'available' as const, version: '1.0.0' };
  const connection = {
    state: 'configured' as const,
    connectionId: 'connection',
    routeId: 'route',
    revision: 1,
  };
  expect(builtinAgentReady({ runtime, connection })).toBe(true);
  expect(
    builtinAgentReady({ runtime: { state: 'unavailable', reason: 'not-implemented' }, connection }),
  ).toBe(false);
  expect(builtinAgentReady({ runtime, connection: { state: 'not-configured' } })).toBe(false);
  expect(
    builtinAgentReady({
      runtime,
      connection: {
        state: 'unavailable',
        connectionId: 'connection',
        reason: 'credential-revoked',
      },
    }),
  ).toBe(false);
});

it('rejects incompatible host/events/journal/projector formats independently of manifest v1', () => {
  expect(() => requireBuiltinCompatibility(BUILTIN_CONTRACT_VERSIONS)).not.toThrow();
  for (const key of Object.keys(BUILTIN_CONTRACT_VERSIONS))
    expect(() =>
      requireBuiltinCompatibility({
        ...BUILTIN_CONTRACT_VERSIONS,
        [key]: BUILTIN_CONTRACT_VERSIONS[key as keyof typeof BUILTIN_CONTRACT_VERSIONS] + 1,
      }),
    ).toThrow(`Unsupported builtin ${key}`);
});
