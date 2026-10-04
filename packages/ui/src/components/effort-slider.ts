// Geometry of the effort slider: steps sit 14px in from both ends of the track.

/** Horizontal position of step `k` of `n`. */
export function stepPosition(k: number, n: number): string {
  return n > 1 ? `calc(14px + (100% - 28px) * ${(k / (n - 1)).toFixed(4)})` : '50%';
}

/** Width of the filled part up to step `index`, covering the knob. */
export function fillWidth(index: number, n: number): string {
  return n > 1 ? `calc(22px + (100% - 28px) * ${(index / (n - 1)).toFixed(4)})` : '100%';
}

/**
 * Steps before the current one are lit, the current one hides under the knob; the default
 * step is a taller, lighter mark.
 */
export function tickColor(k: number, index: number, def: number): string {
  if (k === index) return 'transparent';
  if (k < index) return 'var(--sk-white-a55)';
  return k === def ? 'var(--sk-fill-38)' : 'var(--sk-fill-35)';
}

/** "Рекомендуется" is centred under the default step, kept inside the track at the ends. */
export function recommendedShift(def: number, n: number): string {
  return def === 0 ? '0%' : def === n - 1 ? '-100%' : '-50%';
}

/** The step nearest to pointer `x` on a track at `rect`. */
export function stepAt(x: number, rect: { left: number; width: number }, n: number): number {
  const f = (x - rect.left - 14) / Math.max(1, rect.width - 28);
  return Math.round(f * (n - 1));
}
