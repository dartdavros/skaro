import {
  incidentHash,
  remedyKey,
  remedyAuthority,
  type AppDb,
  type CoordinationBlocker,
  type RemedyAction,
  type RemedyPolicy,
  type RemedyApproval,
} from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { incidentAction } from './incident-condition';

interface EnvironmentWait {
  action: string;
  subscriptions: string;
  policy: number;
  expiresAt: number;
}
const key = (id: string) => `coordination.environment-wait.${id}`;
interface WaitContext {
  deps: { db: Pick<AppDb, 'getSetting'> };
  incidents: {
    policy: {
      read(project: string): RemedyPolicy;
      approval(action: RemedyAction): RemedyApproval | undefined;
    };
  };
}

/** Transfer only the actual controller-observed, authorized start. Worker prose cannot create it. */
export async function rememberEnvironmentWait(ctx: TaskRunEngine, row: CoordinationBlocker) {
  const action = await incidentAction(ctx, row);
  if (!action || action.kind !== 'environment.start') return;
  ctx.deps.db.setSetting(key(row.id), {
    action: remedyKey(action),
    subscriptions: incidentHash(row.protocol!.subscriptions),
    policy: ctx.incidents.policy.read(row.projectId).revision,
    expiresAt: Date.now() + 15 * 60_000,
  } satisfies EnvironmentWait);
}

/** Resource waiting is scheduling of the same start, not a new repair permission. Deny/stop still win. */
export function hasEnvironmentWait(
  ctx: WaitContext,
  row: CoordinationBlocker,
  action: RemedyAction,
  executing = false,
  now = Date.now(),
) {
  const saved = ctx.deps.db.getSetting<EnvironmentWait | undefined>(key(row.id), undefined);
  const policy = ctx.incidents.policy.read(row.projectId);
  const authority = remedyAuthority(action, policy, ctx.incidents.policy.approval(action), now);
  return (
    !!saved &&
    action.kind === 'environment.start' &&
    authority !== 'denied' &&
    saved.action === remedyKey(action) &&
    saved.policy === policy.revision &&
    saved.subscriptions === incidentHash(row.protocol!.subscriptions) &&
    now < Math.min(saved.expiresAt, policy.expiresAt) &&
    row.protocol!.attempts === (executing ? 1 : 0)
  );
}
