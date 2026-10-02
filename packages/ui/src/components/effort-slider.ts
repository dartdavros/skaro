// Geometry of the effort slider: steps sit 12px in from both ends of the track.

/** Horizontal position of step `k` of `n`. */
export function stepPosition(k: number, n: number): string {
  return n > 1 ? `calc(12px + (100% - 24px) * ${(k / (n - 1)).toFixed(4)})` : '50%';
}

/** Width of the filled part up to step `index`, covering the knob. */
export function fillWidth(index: number, n: number): string {
  return n > 1 ? `calc(23px + (100% - 24px) * ${(index / (n - 1)).toFixed(4)})` : '100%';
}

/** Steps before the current one are lit, the current one hides under the knob. */
export function dotColor(k: number, index: number): string {
  return k < index ? 'var(--sk-white-a55)' : k === index ? 'transparent' : 'var(--sk-fill-36)';
}

/** The step nearest to pointer `x` on a track at `rect`. */
export function stepAt(x: number, rect: { left: number; width: number }, n: number): number {
  const f = (x - rect.left - 12) / Math.max(1, rect.width - 24);
  return Math.round(f * (n - 1));
}
