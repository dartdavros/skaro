/** Stop waiting for a read as soon as this attachment/reader loses its authority. */
export function untilCancelled<T>(read: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    void read.then(
      (value) => {
        signal.removeEventListener('abort', cancel);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', cancel);
        reject(error);
      },
    );
  });
}

export async function readSessionEvents<T>(
  events: AsyncIterable<T>,
  signal: AbortSignal,
  apply: (event: T) => void,
) {
  const iterator = events[Symbol.asyncIterator]();
  try {
    while (!signal.aborted) {
      const item = await untilCancelled(iterator.next(), signal);
      if (item.done || signal.aborted) return;
      apply(item.value);
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    if (signal.aborted) void iterator.return?.().catch(() => undefined);
  }
}
