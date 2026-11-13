import assert from 'node:assert/strict';
import type { Services } from '../app-services';
import { RESOURCE_POLICY_KEY } from '../resource-policy';
import { cleanCompletedWorktrees } from '../task-worktree-retention';
import { eventually } from './resource-workflow-observation';
import type { RecoveryCase } from './resource-recovery-case';

/** An actual owner-configured account cap, never a fabricated provider-quota event. */
export async function recoveryModelWait(s: Services, scenario: RecoveryCase) {
  const original = s.db.getSetting<Record<string, unknown>>(RESOURCE_POLICY_KEY, {});
  const account = s.db.admission
    .all()
    .findLast((l) => l.projectId === scenario.project && l.account)?.account;
  assert(account, 'Use a real account already recorded by native admission');
  const accounts = (original.accounts ?? {}) as Record<string, { slots: number; blocked: boolean }>;
  assert(!accounts[account]?.blocked);
  assert((accounts[account]?.slots ?? 1) > 0);
  const owner = `${scenario.pin}:model-wait`;
  const cap = (blocked: boolean) => {
    s.db.setSetting(RESOURCE_POLICY_KEY, {
      ...original,
      accounts: {
        ...accounts,
        [account]: {
          slots: accounts[account]?.slots ?? 1,
          blocked,
        },
      },
    });
    s.resources.manager.poke();
  };
  const wait = () =>
    s.resources.scope(scenario.project, owner, async () => {
      const held = await s.resources.acquire('model', undefined, { account });
      held.release('verification_model_permit_only_no_native_session_started');
    });
  try {
    cap(true);
    const pending = wait().then(
      () => 'unexpected-grant',
      (error) => String(error),
    );
    const held = await eventually(
      () => s.db.admission.all().findLast((l) => l.ownerId === owner),
      (l) => l?.state === 'waiting_quota',
      'configured real account block',
    );
    assert(held);
    const durableWait = { id: held.id, state: held.state, reason: held.reason, account };
    await cleanCompletedWorktrees(s.runs['engine']);
    s.resources.stopOwner(scenario.project, owner);
    assert.match(await pending, /Stopped by owner/);
    cap(false);
    assert.equal(s.db.admission.get(scenario.project, held.id)?.state, 'stopped_by_owner');
    await wait();
    const fresh = s.db.admission.all().findLast((l) => l.ownerId === owner)!;
    assert.equal(fresh.state, 'released');
    return {
      durableWait,
      stoppedDidNotResume: true,
      freshAdmission: fresh.id,
      housekeepingWithoutModel: true,
      noNativeSessionStarted: true,
      providerOutageInjected: false,
    };
  } finally {
    s.resources.stopOwner(scenario.project, owner);
    s.db.setSetting(RESOURCE_POLICY_KEY, original);
    s.resources.manager.poke();
  }
}
