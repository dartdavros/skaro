const TAU = Math.PI * 2;
export const FLIGHT_DURATION = 14;

function smoothstep(value) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/** Deterministic trajectory in metres, Y-up. Size changes come from perspective. */
export function sampleFlight(seconds, duration = FLIGHT_DURATION) {
  if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) {
    throw new RangeError('Flight time must be finite; duration must be positive.');
  }
  const time = Math.min(duration, Math.max(0, seconds));
  const progress = time / duration;
  const angle = TAU * progress;
  const envelope = smoothstep(time / 1.2) * smoothstep((duration - time) / 1.4);
  const pulse = (0.5 - 0.5 * Math.cos((TAU * time) / 1.3)) ** 1.7;
  return {
    // Keep the near arc shallow enough to remain inside a full-screen viewport.
    position: [4.5 * Math.sin(angle), -0.8 - 0.55 * Math.cos(angle), -1.3 - 3.7 * Math.cos(angle)],
    rotation: [0.18 * Math.sin(angle * 2), 0.45 + TAU * 4 * progress, 0.21 * Math.sin(angle)],
    opacity: envelope * (0.89 + 0.11 * Math.sin((TAU * time) / 3.1)),
    lamp: 0.08 + 0.92 * pulse,
    progress,
    behindPlanet: Math.cos(angle) > 0,
    done: seconds >= duration,
  };
}
