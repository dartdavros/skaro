import type { AgentLimits } from '@skaro/timeline';

/** The most restrictive known subscription window; missing values stay unknown. */
export function remainingLimit(snapshot: AgentLimits | undefined): number | undefined {
  const values =
    snapshot?.windows.flatMap(({ remainingPercent }) =>
      remainingPercent !== null &&
      Number.isFinite(remainingPercent) &&
      remainingPercent >= 0 &&
      remainingPercent <= 100
        ? [remainingPercent]
        : [],
    ) ?? [];
  return values.length ? Math.min(...values) : undefined;
}

/** The gauge includes exactly 10%; unknown quota retains its neutral appearance. */
export function limitGaugeColor(remaining: number | undefined): string {
  return remaining !== undefined && remaining >= 0 && remaining <= 10
    ? 'var(--sk-red-4)'
    : 'var(--sk-text-1)';
}

/** Exactly 10% is not low. */
export function lowRemaining(snapshot: AgentLimits | undefined): number | undefined {
  const remaining = remainingLimit(snapshot);
  return remaining !== undefined && remaining < 10 ? remaining : undefined;
}

export function lowPercentLabel(remaining: number, locale: string): string {
  // A value below 10 must not round up to the non-warning threshold.
  return (
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
      Math.floor(remaining * 10) / 10,
    ) + '%'
  );
}
