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

function isLow(remaining: number | undefined): remaining is number {
  return remaining !== undefined && remaining >= 0 && remaining < 15;
}

export function limitGaugeColor(remaining: number | undefined): string {
  return isLow(remaining) ? 'var(--sk-red-4)' : 'var(--sk-text-1)';
}

export function lowRemaining(snapshot: AgentLimits | undefined): number | undefined {
  const remaining = remainingLimit(snapshot);
  return isLow(remaining) ? remaining : undefined;
}

export function lowPercentLabel(remaining: number, locale: string): string {
  // A value below 15 must not round up to the non-warning threshold.
  return (
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
      Math.floor(remaining * 10) / 10,
    ) + '%'
  );
}
