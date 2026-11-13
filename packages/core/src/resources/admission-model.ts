/** Independent capacities; a human preview never consumes a model slot. */
export const RESOURCE_CAPACITIES = [
  'ramBytes',
  'cpuMillis',
  'model',
  'environment',
  'build',
  'review',
] as const;
export type ResourceCapacity = (typeof RESOURCE_CAPACITIES)[number];
export interface ResourceCost extends Record<ResourceCapacity, number> {
  diskBytes: Record<string, number>;
  pools?: Record<string, number>;
}
export interface ResourceBudget extends Record<ResourceCapacity, number | null> {
  /** Free capacity after OS reserves, keyed by actual filesystem identity. Unknown is null. */
  diskBytes: Record<string, number | null>;
  pools?: Record<string, number | null>;
  /** Disk pools backed by a host filesystem also charge that physical volume. */
  poolVolumes?: Record<string, string>;
  measuredAt: number;
  maxAgeMs: number;
  accounts: Record<string, { slots: number; blocked: boolean }>;
}
export interface ResourceLeaseRequest {
  id: string;
  projectId: string;
  ownerId: string;
  intentId: string;
  checkpoint: string;
  /** Account identity from trusted credential routing, never a secret or worker-supplied alias. */
  account?: string;
  cost: ResourceCost;
  locks: { resourceId: string; generation: number; mode: 'shared' | 'exclusive' }[];
}
export interface ResourceLease extends ResourceLeaseRequest {
  revision: number;
  sequence: number;
  state:
    | 'waiting_resource'
    | 'waiting_quota'
    | 'granted'
    | 'retained'
    | 'released'
    | 'stopped_by_owner'
    | 'cancelled';
  reason: string;
  createdAt: number;
  updatedAt: number;
  evidence?: string;
}
export const ownsResourceCapacity = (lease: ResourceLease) =>
  lease.state === 'granted' || lease.state === 'retained';
