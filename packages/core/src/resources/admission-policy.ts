import {
  RESOURCE_CAPACITIES,
  ownsResourceCapacity,
  type ResourceBudget,
  type ResourceLease,
  type ResourceLeaseRequest,
} from './admission-model.ts';

const amount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const id = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= 4096 && !/[\r\n\0]/.test(value);
export function validateResourceRequest(request: ResourceLeaseRequest): void {
  if (
    ![request.id, request.projectId, request.ownerId, request.intentId, request.checkpoint].every(
      id,
    ) ||
    (request.account !== undefined && !id(request.account)) ||
    !request.cost ||
    !RESOURCE_CAPACITIES.every((key) => amount(request.cost[key])) ||
    !request.cost.diskBytes ||
    !Object.entries(request.cost.diskBytes).every(([key, value]) => id(key) && amount(value)) ||
    (request.cost.pools !== undefined &&
      (!request.cost.pools ||
        !Object.entries(request.cost.pools).every(([key, value]) => id(key) && amount(value)))) ||
    !Array.isArray(request.locks) ||
    !request.locks.every(
      (lock) =>
        lock &&
        id(lock.resourceId) &&
        amount(lock.generation) &&
        lock.generation > 0 &&
        ['shared', 'exclusive'].includes(lock.mode),
    ) ||
    new Set(request.locks.map((lock) => lock.resourceId)).size !== request.locks.length
  )
    throw new Error('Invalid resource admission request');
  if (request.cost.model && !request.account)
    throw new Error('Model admission requires an account');
}
export function validateResourceBudget(budget: ResourceBudget): void {
  if (
    !budget ||
    !amount(budget.measuredAt) ||
    !amount(budget.maxAgeMs) ||
    !budget.maxAgeMs ||
    !RESOURCE_CAPACITIES.every((key) => budget[key] === null || amount(budget[key])) ||
    !budget.diskBytes ||
    !Object.entries(budget.diskBytes).every(
      ([key, value]) => id(key) && (value === null || amount(value)),
    ) ||
    !budget.accounts ||
    (budget.observedUsage !== undefined &&
      (!budget.observedUsage ||
        !Object.entries(budget.observedUsage).every(
          ([key, usage]) =>
            id(key) &&
            usage &&
            amount(usage.ramBytes) &&
            amount(usage.cpuMillis) &&
            (usage.pools === undefined ||
              (!!usage.pools &&
                Object.entries(usage.pools).every(([pool, used]) => id(pool) && amount(used)))),
        ))) ||
    (budget.poolVolumes !== undefined &&
      (!budget.poolVolumes ||
        !Object.entries(budget.poolVolumes).every(([pool, volume]) => id(pool) && id(volume)))) ||
    (budget.pools !== undefined &&
      (!budget.pools ||
        !Object.entries(budget.pools).every(
          ([key, value]) => id(key) && (value === null || amount(value)),
        ))) ||
    !Object.entries(budget.accounts).every(
      ([key, value]) =>
        id(key) && value && amount(value.slots) && typeof value.blocked === 'boolean',
    )
  )
    throw new Error('Invalid resource budget');
}

/** Admission protects ownership and exclusion only. Capacity observations never gate execution. */
export function resourceAdmissionReason(
  request: ResourceLease,
  leases: readonly ResourceLease[],
  _budget?: ResourceBudget,
  _now?: number,
): string | undefined {
  validateResourceRequest(request);
  const holders = leases.filter((lease) => lease.id !== request.id && ownsResourceCapacity(lease));
  for (const lock of request.locks) {
    for (const holder of holders) {
      const owned = holder.locks.find((other) => other.resourceId === lock.resourceId);
      if (!owned) continue;
      if (owned.generation !== lock.generation || lock.mode === 'exclusive')
        return 'resource_locked';
      // Before shared chat access, a retained chat turn pinned this same checkout exclusively.
      // It still protects the generation against cleanup, including after an unclean shutdown.
      if (
        owned.mode === 'exclusive' &&
        !(
          holder.state === 'retained' &&
          holder.checkpoint === 'project-chat-controller' &&
          holder.ownerId.startsWith('chat:') &&
          holder.projectId === request.projectId &&
          holder.locks.length === 1
        )
      )
        return 'resource_locked';
    }
  }
}
