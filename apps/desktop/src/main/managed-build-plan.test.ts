import { expect, it } from 'vitest';
import { verifyManagedRunPlan } from './managed-build-profile';

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
it('requires actual resource metadata and capability on every expected RUN before execution', () => {
  expect(() => verifyManagedRunPlan(plan(), 2)).not.toThrow();
  for (const index of [0, 1]) {
    for (const field of ['memory', 'memorySwap', 'cpuQuota', 'cpuPeriod'] as const) {
      const changed = plan();
      changed.metadata[digest(index)]!.linux_resources[field] = '0';
      expect(() => verifyManagedRunPlan(changed, 2)).toThrow('run_resources_capability_unverified');
    }
    const missingResources = plan();
    Reflect.deleteProperty(missingResources.metadata[digest(index)]!, 'linux_resources');
    expect(() => verifyManagedRunPlan(missingResources, 2)).toThrow(
      'run_resources_capability_unverified',
    );
    const missingCapability = plan();
    missingCapability.metadata[digest(index)]!.caps['exec.meta.linux.resources'] = false;
    expect(() => verifyManagedRunPlan(missingCapability, 2)).toThrow(
      'run_resources_capability_unverified',
    );
    for (const invalid of [null, true, [536870912], '5.36870912e8']) {
      const malformed = plan();
      Object.assign(malformed.metadata[digest(index)]!.linux_resources, { memory: invalid });
      expect(() => verifyManagedRunPlan(malformed, 2)).toThrow(
        'run_resources_capability_unverified',
      );
    }
  }
});
it('rejects inherited or missing exec operations and unapproved network/security modes', () => {
  for (const count of [0, 1, 3])
    expect(() => verifyManagedRunPlan(plan(count), 2)).toThrow(
      'unexpected_inherited_exec_or_missing_resources',
    );
  for (const field of ['network', 'security'] as const) {
    const changed = plan();
    changed.def[digest(1)]!.exec[field] = field === 'network' ? 'HOST' : 'INSECURE';
    expect(() => verifyManagedRunPlan(changed, 2)).toThrow('run_resources_capability_unverified');
  }
  expect(() => verifyManagedRunPlan({}, 2)).toThrow('run_resources_capability_unverified');
});
