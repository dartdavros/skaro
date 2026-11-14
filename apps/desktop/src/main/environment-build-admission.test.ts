import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { ApplicationResources } from './application-resources';
import { RESOURCE_POLICY_KEY } from './resource-policy';
import { ResourceAdmissionUnavailable } from './resource-manager';

it('returns a measured build-slot checkpoint without holding a worker or invoking the environment', async () => {
  const db = AppDb.open(':memory:');
  const project = db.addProject({ name: 'Observed repository', path: process.cwd() });
  const resources = new ApplicationResources(db, process.cwd());
  try {
    db.setSetting(RESOURCE_POLICY_KEY, { build: 0 });
    // Isolate the real slot policy, without replacing any host measurements or external executor.
    db.setSetting('resources.costs.v1', { build: { cpuMillis: 0, disk: 0 } });
    let entered = false;
    await expect(
      resources.scope(project.id, 'observed-environment', () =>
        resources.phase(
          'build',
          async () => {
            entered = true;
          },
          undefined,
          { wait: false },
        ),
      ),
    ).rejects.toBeInstanceOf(ResourceAdmissionUnavailable);
    expect(entered).toBe(false);
    expect(db.admission.all().find((row) => row.ownerId === 'observed-environment')?.reason).toBe(
      'budget_build',
    );
    expect(resources.holdings(project.id, 'observed-environment')).toEqual([]);
  } finally {
    await resources.close();
    db.close();
  }
});
