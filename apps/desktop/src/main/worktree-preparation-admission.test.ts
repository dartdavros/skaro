import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { resolve } from 'node:path';
import { ApplicationResources } from './application-resources';
import { RESOURCE_POLICY_KEY } from './resource-policy';
import { admitWorktreePreparation } from './worktree-preparation-admission';

/** Real SQLite over the current repository; no external work or fabricated environment. */
it('prepares without a CPU capacity prerequisite and reuses one ownership reservation', async () => {
  const root = resolve(process.cwd()),
    db = AppDb.open(':memory:');
  const project = db.addProject({ name: 'Current Skaro repository', path: root });
  const resources = new ApplicationResources(db, root),
    owner = 'preparation-observation';
  let executions = 0;
  const prepare = () =>
    resources.scope(project.id, owner, () =>
      admitWorktreePreparation(db.resources, project.id, root, async () => {
        executions++;
        expect(resources.holdings(project.id, owner)).toHaveLength(1);
        await resources.phase('worktree', async () => {
          expect(resources.holdings(project.id, owner)).toHaveLength(1);
        });
      }),
    );
  try {
    db.setSetting(RESOURCE_POLICY_KEY, { reserveCpuMillis: 2 ** 50 });
    await prepare();
    expect(executions).toBe(1);
    expect(resources.holdings(project.id, owner)).toEqual([]);
    await expect(
      resources.scope(project.id, owner, () =>
        admitWorktreePreparation(db.resources, 'foreign-project', root, async () => {
          executions++;
        }),
      ),
    ).rejects.toThrow('outside');
    expect(executions).toBe(1);
  } finally {
    await resources.close();
    db.close();
  }
});
