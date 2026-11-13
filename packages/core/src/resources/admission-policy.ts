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
const poolValue = (values: Record<string, number | null> | undefined, key: string) =>
  values && Object.hasOwn(values, key) ? values[key] : undefined;
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

/** Pure decision. Call under the same transaction that records the grant. Strict FIFO prevents starvation. */
export function resourceAdmissionReason(
  request: ResourceLease,
  leases: readonly ResourceLease[],
  budget: ResourceBudget,
  now: number,
): string | undefined {
  validateResourceRequest(request);
  validateResourceBudget(budget);
  if (!amount(now) || now < budget.measuredAt || now - budget.measuredAt > budget.maxAgeMs)
    return 'metrics_stale';
  const holders = leases.filter((lease) => lease.id !== request.id && ownsResourceCapacity(lease));
  const remaining = (lease: ResourceLease, key: (typeof RESOURCE_CAPACITIES)[number]) => {
    const observed = budget.observedUsage?.[lease.id];
    const used = key === 'ramBytes' || key === 'cpuMillis' ? (observed?.[key] ?? 0) : 0;
    return Math.max(0, lease.cost[key] - used);
  };
  const accountAvailable = (other: ResourceLease): boolean => {
    if (!other.account || !other.cost.model) return true;
    const account = Object.hasOwn(budget.accounts, other.account)
      ? budget.accounts[other.account]
      : undefined;
    return (
      !!account &&
      !account.blocked &&
      holders
        .filter((lease) => lease.account === other.account)
        .reduce((sum, lease) => sum + lease.cost.model, other.cost.model) <= account.slots
    );
  };
  if (request.account && request.cost.model) {
    const account = Object.hasOwn(budget.accounts, request.account)
      ? budget.accounts[request.account]
      : undefined;
    if (!account || account.blocked) return 'account_quota_unknown_or_blocked';
    const used = holders
      .filter((lease) => lease.account === request.account)
      .reduce((sum, lease) => sum + lease.cost.model, 0);
    if (used + request.cost.model > account.slots) return 'account_slots';
  }
  for (const lock of request.locks) {
    for (const holder of holders) {
      const owned = holder.locks.find((other) => other.resourceId === lock.resourceId);
      if (
        owned &&
        (owned.generation !== lock.generation ||
          owned.mode === 'exclusive' ||
          lock.mode === 'exclusive')
      )
        return 'resource_locked';
    }
  }
  for (const key of RESOURCE_CAPACITIES) {
    if (!request.cost[key]) continue;
    const available = budget[key];
    if (available === null) return `unknown_${key}`;
    if (holders.reduce((sum, lease) => sum + remaining(lease, key), request.cost[key]) > available)
      return `budget_${key}`;
  }
  const diskCost = (lease: ResourceLease, volume: string) =>
    (Object.hasOwn(lease.cost.diskBytes, volume) ? lease.cost.diskBytes[volume]! : 0) +
    Object.entries(budget.poolVolumes ?? {}).reduce(
      (sum, [pool, physical]) =>
        sum + (physical === volume ? (poolValue(lease.cost.pools, pool) ?? 0) : 0),
      0,
    );
  const volumes = new Set([
    ...Object.keys(request.cost.diskBytes),
    ...Object.values(budget.poolVolumes ?? {}),
  ]);
  for (const volume of volumes) {
    const needed = diskCost(request, volume);
    if (!needed) continue;
    const available = Object.hasOwn(budget.diskBytes, volume)
      ? budget.diskBytes[volume]
      : undefined;
    if (available === undefined || available === null) return 'unknown_disk';
    if (holders.reduce((sum, lease) => sum + diskCost(lease, volume), needed) > available)
      return 'budget_disk';
  }
  for (const [pool, needed] of Object.entries(request.cost.pools ?? {})) {
    if (!needed) continue;
    const available = poolValue(budget.pools, pool);
    if (available === undefined || available === null) return `unknown_pool:${pool}`;
    if (
      holders.reduce(
        (sum, lease) =>
          sum +
          Math.max(
            0,
            (poolValue(lease.cost.pools, pool) ?? 0) -
              (budget.observedUsage?.[lease.id]?.pools?.[pool] ?? 0),
          ),
        needed,
      ) > available
    )
      return `budget_pool:${pool}`;
  }
  const competing = (other: ResourceLease) => {
    // A queued build must not block an admitted worker's environment slot: that would prevent
    // the worker from completing and returning the very build capacity the older job needs.
    const bottleneck = RESOURCE_CAPACITIES.find(
      (key) => other.reason === `budget_${key}` || other.reason === `unknown_${key}`,
    );
    if (bottleneck) return request.cost[bottleneck] > 0 && other.cost[bottleneck] > 0;
    return (
      RESOURCE_CAPACITIES.some((key) => request.cost[key] > 0 && other.cost[key] > 0) ||
      [...volumes].some((volume) => diskCost(request, volume) > 0 && diskCost(other, volume) > 0) ||
      Object.keys(request.cost.pools ?? {}).some(
        (pool) =>
          (poolValue(request.cost.pools, pool) ?? 0) > 0 &&
          (poolValue(other.cost.pools, pool) ?? 0) > 0,
      ) ||
      request.locks.some((lock) =>
        other.locks.some((candidate) => candidate.resourceId === lock.resourceId),
      )
    );
  };
  if (
    leases.some(
      (other) =>
        other.sequence < request.sequence &&
        (other.state === 'waiting_resource' ||
          (other.state === 'waiting_quota' && accountAvailable(other))) &&
        competing(other),
    )
  )
    return 'older_request';
}
