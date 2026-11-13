import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Services } from '../app-services';
import { RESOURCE_POLICY_KEY } from '../resource-policy';
import type { ResourceBudgetPolicy } from '../resource-budget';
import { dispatchState, setCoordinationDispatch } from '../coordination-dispatch';
import { eventually, requireReleased } from './resource-workflow-observation';

/** Actual configured account cap and measured admission; no fabricated provider-limit observation. */
export async function coordinatorQuota(
  s: Services,
  projectId: string,
  reenable?: () => Promise<unknown>,
) {
  const previous = s.db.getSetting<Partial<ResourceBudgetPolicy> | null>(RESOURCE_POLICY_KEY, null);
  assert(previous, 'Use the real configured resource policy');
  const account = s.db.admission
    .all()
    .find((r) => r.projectId === projectId && r.ownerId === 'task:T-010' && r.account)?.account;
  assert(account, 'Use the existing trusted native account identity');
  assert(
    previous.accounts?.[account]?.blocked !== true,
    'Do not override an existing owner account prohibition',
  );
  assert(
    (previous.accounts?.[account]?.slots ?? 1) > 0,
    'Do not lift an existing zero account cap',
  );
  const owner = `verification:ac5-quota:${randomUUID()}`;
  const originalDispatch = dispatchState(s.db, projectId);
  assert(originalDispatch.enabled);
  const cap = (blocked: boolean) => {
    s.db.setSetting(RESOURCE_POLICY_KEY, {
      ...previous,
      accounts: {
        ...previous.accounts,
        [account]: { slots: previous.accounts?.[account]?.slots ?? 1, blocked },
      },
    });
    s.resources.manager.poke();
  };
  const wait = () =>
    s.resources.scope(projectId, owner, async () => {
      const held = await s.resources.acquire('model', undefined, { account });
      held.release('verification_permit_observed_no_model_started');
    });
  try {
    cap(true);
    const stopped = wait().then(
      () => 'unexpected-grant',
      (error) => String(error),
    );
    const first = await eventually(
      () =>
        s.db.admission
          .all()
          .filter((r) => r.ownerId === owner)
          .at(-1),
      (r) => r?.state === 'waiting_quota',
      'real configured account cap',
    );
    assert(first);
    requireReleased(s, projectId, owner);
    // Model availability is irrelevant to this actual filesystem housekeeping observation.
    await s.resources.scope(projectId, `${owner}:housekeeping`, () =>
      s.resources.phase('review', async () => {
        assert((await readFile(join(s.projects.get(projectId).root, 'index.html'))).length > 0);
      }),
    );
    s.resources.stopOwner(projectId, owner);
    assert.match(await stopped, /Stopped by owner/);
    cap(false);
    assert.equal(s.db.admission.get(projectId, first.id)?.state, 'stopped_by_owner');
    cap(true);
    const fenced = wait().then(
      () => 'unexpected-grant',
      (error) => String(error),
    );
    const second = await eventually(
      () =>
        s.db.admission
          .all()
          .filter((r) => r.ownerId === owner)
          .at(-1),
      (r) => r?.id !== first.id && r?.state === 'waiting_quota',
      'renewed account wait',
    );
    const off = setCoordinationDispatch(s.db, projectId, false, originalDispatch.revision);
    if (reenable) await reenable();
    else setCoordinationDispatch(s.db, projectId, true, off.revision);
    cap(false);
    assert.match(await fenced, /suspended/);
    assert.equal(s.db.admission.get(projectId, second!.id)?.state, 'stopped_by_owner');
    await wait();
    const fresh = s.db.admission
      .all()
      .filter((r) => r.ownerId === owner)
      .at(-1)!;
    assert.equal(fresh.state, 'released');
    requireReleased(s, projectId, owner);
    return {
      accountCap: 'configured-owner-policy',
      waitingLease: first.id,
      stoppedPreserved: true,
      oldGenerationFenced: second!.id,
      freshReadmission: fresh.id,
      noModelStarted: true,
      waitingHoldsCapacity: false,
      actualHousekeepingWhileModelBlocked: true,
    };
  } finally {
    s.resources.stopOwner(projectId, owner);
    s.db.setSetting(RESOURCE_POLICY_KEY, previous);
    s.resources.manager.poke();
    const current = dispatchState(s.db, projectId);
    if (current.enabled !== originalDispatch.enabled)
      if (reenable && originalDispatch.enabled) await reenable();
      else setCoordinationDispatch(s.db, projectId, originalDispatch.enabled, current.revision);
  }
}
