import type { RuntimeSession } from '../session.ts';
import { fingerprint } from '../verification/inputs.ts';

/** Called inside the command queue, before acknowledging a fresh owner turn. No model transport. */
export async function refreshOwnerContext(
  session: Pick<RuntimeSession, 'context' | 'journal'>,
  commandId: string,
  signal: AbortSignal,
) {
  if (!session.context) return;
  signal.throwIfAborted();
  const value = await session.context.project(false, signal);
  signal.throwIfAborted();
  return session.journal.append(
    `owner-context:${commandId}`,
    [],
    { value },
    fingerprint({ type: 'refreshContext' }),
  );
}
