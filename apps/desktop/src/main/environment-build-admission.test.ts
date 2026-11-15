import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { ApplicationResources } from './application-resources';
import { RESOURCE_POLICY_KEY } from './resource-policy';

it('runs authorized build work despite a zero legacy capacity setting', async () => {
  const db = AppDb.open(':memory:');
  const project = db.addProject({ name: 'Observed repository', path: process.cwd() });
  const resources = new ApplicationResources(db, process.cwd());
  try {
    db.setSetting(RESOURCE_POLICY_KEY, { build: 0 });
    // Isolate the real slot policy, without replacing any host measurements or external executor.
    db.setSetting('resources.costs.v1', { build: { cpuMillis: 0, disk: 0 } });
    let entered = false;
    await resources.scope(project.id, 'observed-environment', () =>
      resources.phase(
        'build',
        async () => {
          entered = true;
        },
        undefined,
        { wait: false },
      ),
    );
    expect(entered).toBe(true);
    expect(db.admission.all().find((row) => row.ownerId === 'observed-environment')?.reason).toBe(
      'teardown_confirmed',
    );
    expect(resources.holdings(project.id, 'observed-environment')).toEqual([]);
  } finally {
    await resources.close();
    db.close();
  }
});
