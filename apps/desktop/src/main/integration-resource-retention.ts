import { lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  containsPath,
  git,
  resourceId,
  type AppDb,
  type ResourceConsumer,
  type ResourceRecord,
  type ResourceRegistration,
} from '@skaro/core';
import type { ProjectContext } from './projects';
import type { TaskRunEngine } from './task-run-engine';
import {
  integrationEnvironmentKey,
  integrationQueueKey,
  type IntegrationOperation,
} from './integration-model';

type Owner = Pick<IntegrationOperation, 'id' | 'projectId' | 'worktree' | 'head' | 'fingerprint'>;
export interface IntegrationRemovalCheckpoint extends Owner {
  resourceId: string;
  generation: number;
}
export const integrationRemovalKey = (id: string) => `integration.${id}.resource-removal`;
export const integrationRecoveryRef = (id: string) => `refs/skaro/integrations/${id}`;

/** An operation path alone is never ownership: it must equal the service's allocation formula. */
export function managedIntegrationPath(dataDir: string, op: Owner): string | undefined {
  if (![op.id, op.projectId].every((id) => /^[a-zA-Z0-9_-]+$/.test(id))) return undefined;
  const expected = resolve(dataDir, 'integrations', op.projectId, op.id, 'checkout');
  return resolve(op.worktree) === expected ? expected : undefined;
}

export function integrationResourceBlocker(
  resource: ResourceRegistration,
  op: Owner,
): string | undefined {
  if (
    resource.projectId !== op.projectId ||
    resource.kind !== 'worktree' ||
    resource.owner.kind !== 'integration' ||
    resource.owner.id !== op.id ||
    resource.identity.path !== resolve(op.worktree) ||
    resource.purpose !== 'integration' ||
    resource.ownership !== 'registered' ||
    resource.preservation !== 'disposable'
  )
    return 'integration-ownership-unverified';
  if (resource.state === 'released') return 'released-path-reappeared';
  if (
    resource.source?.commit !== op.head ||
    resource.source.recovery !== integrationRecoveryRef(op.id) ||
    resource.source.declarationRevision !== op.fingerprint
  )
    return 'integration-evidence-changed';
  if (resource.consumers.length) return 'active-consumer';
  return undefined;
}

export function integrationRemovalMatches(
  saved: IntegrationRemovalCheckpoint | null,
  resource: ResourceRecord | undefined,
  op: Owner,
): boolean {
  return (
    !!saved &&
    !!resource &&
    !integrationResourceBlocker(resource, op) &&
    saved.id === op.id &&
    saved.projectId === op.projectId &&
    saved.worktree === op.worktree &&
    saved.head === op.head &&
    saved.fingerprint === op.fingerprint &&
    saved.resourceId === resource.id &&
    saved.generation === resource.generation
  );
}

export interface IntegrationResourceObservation {
  registration: ResourceRegistration;
  present: boolean;
  reason: string;
  resuming: boolean;
}

/** Read-only evidence from an actual saved operation, filesystem and Git; never creates refs. */
export async function integrationResourceObservation(
  db: Pick<AppDb, 'resources' | 'getSetting'>,
  dataDir: string,
  context: Pick<ProjectContext, 'root'>,
  op: IntegrationOperation,
): Promise<IntegrationResourceObservation> {
  const path = resolve(op.worktree);
  const registration: ResourceRegistration = {
    projectId: op.projectId,
    kind: 'worktree',
    identity: { path },
    owner: { kind: 'unknown', id: path },
    purpose: 'unknown',
    ownership: 'legacy-unverified',
    preservation: 'unknown',
    generation: 1,
    consumers: [],
    state: 'retained',
  };
  const observation = {
    registration,
    present: true,
    reason: 'integration-ownership-unverified',
    resuming: false,
  };
  try {
    const stat = await lstat(path);
    if (
      !managedIntegrationPath(dataDir, op) ||
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      resolve(await realpath(path)) !==
        resolve(await realpath(dataDir), 'integrations', op.projectId, op.id, 'checkout')
    )
      return observation;
    const registered = (await git(context.root, ['worktree', 'list', '--porcelain', '-z'])).stdout
      .split('\0')
      .filter((entry) => entry.startsWith('worktree '))
      .map((entry) => resolve(entry.slice(9)));
    if (!registered.includes(path)) {
      observation.reason = 'git-registration-unavailable';
      return observation;
    }
    const common = async (cwd: string) =>
      realpath(
        (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim(),
      );
    const symbolic = await git(path, ['symbolic-ref', '--quiet', 'HEAD'], { allowFail: true });
    if (
      symbolic.code !== 1 ||
      (await common(path)) !== (await common(context.root)) ||
      (await git(path, ['rev-parse', 'HEAD'])).stdout.trim() !== op.head
    ) {
      observation.reason = 'integration-git-identity-changed';
      return observation;
    }
    const ref = integrationRecoveryRef(op.id);
    const preserved = await git(context.root, ['rev-parse', '--verify', '--quiet', ref], {
      allowFail: true,
    });
    if (preserved.code !== 1 && (preserved.code !== 0 || preserved.stdout.trim() !== op.head)) {
      observation.reason = 'integration-recovery-ref-changed';
      return observation;
    }
    registration.owner = { kind: 'integration', id: op.id };
    registration.purpose = 'integration';
    registration.ownership = 'registered';
    registration.preservation = 'disposable';
    registration.source = { commit: op.head, recovery: ref, declarationRevision: op.fingerprint };
    const resource = db.resources.get(resourceId(registration));
    observation.resuming = integrationRemovalMatches(
      db.getSetting<IntegrationRemovalCheckpoint | null>(integrationRemovalKey(op.id), null, {
        strict: true,
      }),
      resource,
      op,
    );
    if (
      !observation.resuming &&
      (await git(path, ['status', '--porcelain', '--untracked-files=all'])).stdout.trim()
    ) {
      registration.preservation = 'unique';
      observation.reason = 'integration-unique-changes';
    } else observation.reason = 'integration-checkout-verified';
  } catch {
    // Only the initial lstat can prove absence; an unavailable parent/repository is not absence.
    observation.reason = 'inspection-unavailable';
    try {
      await lstat(path);
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code === 'ENOENT') {
        observation.present = false;
        observation.reason = 'path-absent';
      }
    }
  }
  return observation;
}

/** Consumers are observations, not RC-2 admission leases. Preserve unrelated ledger consumers. */
export function integrationResourceConsumers(
  ctx: TaskRunEngine,
  op: IntegrationOperation,
  generation: number,
): ResourceConsumer[] {
  const consumers: ResourceConsumer[] = [];
  const add = (id: string, kind: ResourceConsumer['kind']) =>
    consumers.push({ id: `integration-checkout:${id}`, kind, generation });
  if (op.worker || op.executor || ctx.integrations.executing(op.id)) add(op.id, 'integration');
  const queue = ctx.queue.state();
  if ([...queue.running, ...queue.queued].includes(integrationQueueKey(op)))
    add(`queue:${op.id}`, 'integration');
  const key = integrationEnvironmentKey(op);
  if (
    ctx.reviews
      .protectedEnvironments()
      .some((item) => item.projectId === key.projectId && item.taskId === key.taskId)
  )
    add(`review:${op.id}`, 'preview');
  const overlaps = (path?: string) =>
    !!path && (containsPath(path, op.worktree) || containsPath(op.worktree, path));
  for (const active of ctx.active.values())
    if (
      overlaps(active.run.worktree) &&
      (active.session ||
        active.attaching ||
        active.switching ||
        active.stopping ||
        active.afterTurn ||
        active.release ||
        active.operations.size ||
        active.timeline.state.status !== 'idle')
    )
      add(`run:${active.run.id}`, 'agent');
  for (const candidate of ctx.integrations.store.all(op.projectId))
    if (
      candidate.id !== op.id &&
      (candidate.worker || candidate.executor || !['applied', 'stale'].includes(candidate.state)) &&
      (overlaps(candidate.worktree) ||
        candidate.results.some((result) => overlaps(result.worktree)))
    )
      add(`candidate:${candidate.id}`, 'integration');
  return consumers;
}
