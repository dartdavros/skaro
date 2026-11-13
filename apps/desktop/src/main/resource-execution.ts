import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppDb, ResourceLease, ResourceLeaseRequest } from '@skaro/core';
import type { ApplicationResources } from './application-resources';
import type { ResourceWork } from './resource-policy';

export interface ResourceExecution {
  projectId: string;
  ownerId: string;
  intentId: string;
  dispatchRevision?: number;
  signal: AbortSignal;
  phases?: ReadonlySet<ResourceWork>;
  resources?: ApplicationResources;
  /** Ephemeral admitted cache handle; ledger rows/restored metadata never populate this field. */
  cacheAuthority?: HeldResource;
  requireCurrent(): void | Promise<void>;
}
export interface HeldResource {
  lease: ResourceLease;
  isLive?(): boolean;
  release(evidence: string): void;
  bind(locks: ResourceLeaseRequest['locks']): void;
}
export const resourceExecution = new AsyncLocalStorage<ResourceExecution>();
const applications = new WeakMap<object, ApplicationResources>();
export function bindApplicationResources(db: AppDb, resources: ApplicationResources): void {
  if (applications.has(db)) throw new Error('Application already owns a resource dispatcher');
  applications.set(db, resources);
  applications.set(db.resources, resources);
}
export function resourcesFor(db: object): ApplicationResources | undefined {
  return applications.get(db);
}
export function resourcePhase<T>(kind: ResourceWork, action: () => Promise<T>): Promise<T> {
  const scope = resourceExecution.getStore();
  return scope?.resources ? scope.resources.phase(kind, action, scope) : action();
}
