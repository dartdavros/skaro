import { AsyncLocalStorage } from 'node:async_hooks';
import type { ResourceIdentity } from './model.ts';

export interface ResourceCleanupFence {
  resourceId: string;
  generation: number;
  operationId: string;
  mode: 'remove' | 'maintenance' | 'stop';
  token: string;
  owner: string;
  pid: number;
  identity: ResourceIdentity;
  objectIds: string[];
  signature: string;
  externalPending: boolean;
  authorityLeaseId?: string;
  state: 'claimed' | 'running' | 'retry' | 'verified';
}
export interface ResourceCleanupContext {
  fence: ResourceCleanupFence;
  /** Ephemeral host controller capability; never restored from serialized fence metadata. */
  assertCurrent?(): void;
  localOnly?: boolean;
  readOnly?: boolean;
  effect(external?: boolean): void;
  settled(): void;
}
export const resourceCleanupContext = new AsyncLocalStorage<ResourceCleanupContext>();

/** Only marks an already acquired exact cleanup fence; ordinary unmanaged Git APIs acquire no rights. */
export function markResourceCleanupEffect(path: string, external = false): void {
  const context = resourceCleanupContext.getStore();
  if (!context) return;
  if (context.fence.identity.path !== path)
    throw new Error('Destructive worktree operation differs from the exclusive cleanup identity');
  context.effect(external);
}

export function markResourceCleanupSettled(path: string): void {
  const context = resourceCleanupContext.getStore();
  if (!context) return;
  if (context.fence.identity.path !== path)
    throw new Error('Settled executor differs from its exclusive cleanup identity');
  context.settled();
}

export class ResourceCleanupBlocked extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.reason = reason;
  }
}
