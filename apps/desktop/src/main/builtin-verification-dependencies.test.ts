import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { captureDependencies } from '../../../../packages/agent-runtime/src/verification/dependencies';
import { captureCheckEnvironment } from '../../../../packages/agent-runtime/src/verification/environment';

it('measures actual host files without claiming toolchain or service closure', async () => {
  const signal = new AbortController().signal;
  const runtime = { id: 'runtime', path: await realpath(process.execPath) };
  const measured = await captureCheckEnvironment(signal, [runtime]);
  expect(measured.dependencies).toMatchObject({
    coverage: 'declared-files-only',
    files: [
      { ...runtime, sha256: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: expect.any(Number) },
    ],
  });
  expect(measured.dependencies!.files[0]!.bytes).toBeGreaterThan(0);
  expect(measured.unresolved).toContain('command toolchain resolution and binaries');
  expect(measured.unresolved).toContain('external services and mutable environment');
  const expanded = await captureCheckEnvironment(signal, [
    runtime,
    { id: 'package', path: await realpath(resolve('package.json')) },
  ]);
  expect(expanded.dependencies!.policy).not.toBe(measured.dependencies!.policy);
  expect(expanded.dependencies!.files).toHaveLength(2);
});

it('rejects invalid, missing and cancelled dependency measurements without substitutes', async () => {
  const signal = new AbortController().signal;
  const runtime = { id: 'runtime', path: await realpath(process.execPath) };
  await expect(captureDependencies([], signal)).rejects.toThrow('Invalid host');
  await expect(captureDependencies([runtime, runtime], signal)).rejects.toThrow('Invalid host');
  await expect(
    captureDependencies([{ id: 'relative', path: 'package.json' }], signal),
  ).rejects.toThrow('Invalid host');
  await expect(
    captureDependencies([{ id: 'missing', path: `${runtime.path}.missing` }], signal),
  ).rejects.toThrow('Declared dependency is unavailable');
  const aborted = new AbortController();
  aborted.abort(new Error('Dependency inspection cancelled'));
  await expect(captureDependencies([runtime], aborted.signal)).rejects.toThrow('cancelled');
});
