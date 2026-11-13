import type { ChildProcess } from 'node:child_process';
import { processBirth, stopOwnedProcess } from '@skaro/agent-runtime/process-identity';

/** Cancel the verified process tree before its parent exits; an AbortError alone is not teardown. */
export function shellLifetime(child: ChildProcess, signal?: AbortSignal, timeoutMs?: number) {
  let failure: Error | undefined;
  let stopping: Promise<void> | undefined;
  const identity = child.pid ? processBirth(child.pid) : Promise.resolve(undefined);
  void identity.catch(() => undefined);
  const stop = () => {
    failure ??= new Error(
      signal?.aborted ? 'Shell operation cancelled' : 'Shell deadline exceeded',
    );
    stopping ??= identity.then(async (birth) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (birth && child.pid)
        await stopOwnedProcess({ pid: child.pid, birth, platform: process.platform });
      else if (child.exitCode === null && child.signalCode === null)
        throw new Error('Shell process identity could not be confirmed');
    });
    void stopping.catch((error: unknown) => {
      failure = error instanceof Error ? error : new Error(String(error));
    });
  };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const timer = timeoutMs ? setTimeout(stop, timeoutMs) : undefined;
  timer?.unref();
  return {
    failed(error: Error) {
      failure ??= error;
    },
    stop,
    async ended() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      await identity;
      await stopping;
      if (failure) throw failure;
    },
  };
}
