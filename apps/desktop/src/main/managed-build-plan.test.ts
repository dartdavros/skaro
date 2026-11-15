import { expect, it } from 'vitest';
import { verifyManagedRunPlan } from './managed-build-profile';
import { buildkitGcConfiguration } from './managed-buildkit-policy';
import { unrestrictedBuilderPolicy } from './managed-buildkit-policy-migration';

// Pure protocol-policy inputs; never returned by a Docker client or used as live solve evidence.
const limits = {
  memory: '536870912',
  memorySwap: '536870912',
  cpuQuota: '100000',
  cpuPeriod: '100000',
};
const digest = (index: number) => `sha256:${String(index + 1).padStart(64, '0')}`;
function plan(count = 2) {
  return {
    def: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        digest(index),
        {
          exec: { network: 'UNSET', security: 'SANDBOX' },
        },
      ]),
    ),
    metadata: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        digest(index),
        {
          caps: { 'exec.meta.linux.resources': true },
          linux_resources: { ...limits },
        },
      ]),
    ),
  };
}
it('accepts execution plans without CPU/memory limits or resource-capability metadata', () => {
  const unrestricted = plan();
  for (const metadata of Object.values(unrestricted.metadata)) {
    Reflect.deleteProperty(metadata, 'linux_resources');
    Reflect.deleteProperty(metadata, 'caps');
  }
  expect(verifyManagedRunPlan(unrestricted, 2)).toHaveLength(2);
});
it('rejects inherited or missing exec operations and unapproved network/security modes', () => {
  for (const count of [0, 1, 3])
    expect(() => verifyManagedRunPlan(plan(count), 2)).toThrow(
      'unexpected_inherited_exec_or_missing_runs',
    );
  for (const field of ['network', 'security'] as const) {
    const changed = plan();
    changed.def[digest(1)]!.exec[field] = field === 'network' ? 'HOST' : 'INSECURE';
    expect(() => verifyManagedRunPlan(changed, 2)).toThrow('run_execution_plan_unverified');
  }
  expect(() => verifyManagedRunPlan({}, 2)).toThrow('run_execution_plan_unverified');
});

it('migrates only the exact legacy worker parallelism line without rewriting GC or security policy', () => {
  const current = buildkitGcConfiguration({ bytes: 1024, entries: 1, idleMs: 1000 });
  const legacy = current.replace('[worker.oci]\n', '[worker.oci]\n  max-parallelism = 1\n');
  expect(unrestrictedBuilderPolicy(legacy)).toBe(current);
  expect(unrestrictedBuilderPolicy(current)).toBe(current);
  expect(unrestrictedBuilderPolicy('  max-parallelism = 8\n')).toBe('  max-parallelism = 8\n');
  expect(current).not.toContain('max-parallelism');
});
