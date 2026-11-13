import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { resolve } from 'node:path';
import { ApplicationResources } from './application-resources';
import { RESOURCE_POLICY_KEY } from './resource-policy';
import { admitWorktreePreparation } from './worktree-preparation-admission';

/** Real host measurement and SQLite; no repository/task/filesystem fixture or external effect. */
it('holds preparation before any ledger generation/effect and reuses one admitted reservation', async () => {
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
    db.setSetting(RESOURCE_POLICY_KEY, { reserveRamBytes: 2 ** 50 });
    const pending = prepare().catch((error) => String(error));
    await expect
      .poll(() => db.admission.all().find((l) => l.ownerId === owner)?.reason)
      .toBe('budget_ramBytes');
    expect(executions).toBe(0);
    expect(db.resources.list(project.id)).toEqual([]);
    resources.stopOwner(project.id, owner);
    expect(await pending).toContain('Stopped by owner');
    db.setSetting(RESOURCE_POLICY_KEY, {});
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
