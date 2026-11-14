import type { EnvironmentConfig } from './model.ts';

type Timeouts = NonNullable<EnvironmentConfig['timeouts']>;
const STAGES = ['create', 'start', 'ready'];
// Node timers above this boundary overflow to 1 ms rather than waiting longer.
export const ENVIRONMENT_TIMEOUT_MAX_SECONDS = Math.floor(2_147_483_647 / 1000);

export function readEnvironmentTimeouts(raw: unknown): Timeouts | undefined {
  if (raw === undefined) return;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('timeouts must map create, start or ready to positive integer seconds');
  const entries = Object.entries(raw);
  if (
    entries.some(
      ([stage, seconds]) =>
        !STAGES.includes(stage) ||
        typeof seconds !== 'number' ||
        !Number.isSafeInteger(seconds) ||
        seconds <= 0 ||
        seconds > ENVIRONMENT_TIMEOUT_MAX_SECONDS,
    )
  )
    throw new Error(
      `timeouts must use create, start or ready and seconds from 1 to ${ENVIRONMENT_TIMEOUT_MAX_SECONDS}`,
    );
  return Object.fromEntries(entries);
}

/** An absent command deadline is intentional; readiness retains waitReady's independent default. */
export function environmentTimeoutMs(config: EnvironmentConfig, stage: keyof Timeouts) {
  const seconds = config.timeouts?.[stage];
  return seconds === undefined ? undefined : seconds * 1000;
}
