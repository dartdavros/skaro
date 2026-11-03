import { setTimeout as delay } from 'node:timers/promises';

/** Cancel the unused timer when a process finishes first; shutdown must not wait on it. */
export async function yieldProcess(
  finished: Promise<void>,
  millis: number,
  signal: AbortSignal,
): Promise<void> {
  const timer = new AbortController();
  try {
    await Promise.race([
      finished,
      delay(millis, undefined, { signal: AbortSignal.any([signal, timer.signal]) }),
    ]);
    signal.throwIfAborted();
  } finally {
    timer.abort();
  }
}
