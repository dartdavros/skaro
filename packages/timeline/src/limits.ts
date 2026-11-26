/** Account subscription quotas, independent of a task's token usage. */
export interface AgentLimitWindow {
  kind: 'five_hour' | 'seven_day';
  remainingPercent: number | null;
  resetsAt: string | null;
}

export interface AgentLimits {
  checkedAt: string;
  reached?: boolean;
  windows: AgentLimitWindow[];
}

/** Missing/invalid values stay unknown. A reset never fabricates a replenished quota. */
export function limitWindow(
  kind: AgentLimitWindow['kind'],
  usedPercent: unknown,
  resetsAt: unknown,
): AgentLimitWindow {
  const reset =
    typeof resetsAt === 'number'
      ? resetsAt * 1000
      : typeof resetsAt === 'string'
        ? Date.parse(resetsAt)
        : NaN;
  return {
    kind,
    remainingPercent:
      typeof usedPercent === 'number' && Number.isFinite(usedPercent)
        ? Math.max(0, Math.min(100, 100 - usedPercent))
        : null,
    resetsAt:
      Number.isFinite(reset) && Math.abs(reset) <= 8.64e15 ? new Date(reset).toISOString() : null,
  };
}
