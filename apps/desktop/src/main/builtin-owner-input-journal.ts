import { isDeepStrictEqual } from 'node:util';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import type { RouteSnapshot, RuntimeOwnerInput } from '@skaro/timeline';

/** Read an acknowledged input from the actual primary journal, never from a caller's transcript. */
export async function ownerInputJournal(
  config: { journalPath: string; sessionId: string; route: RouteSnapshot },
  input: RuntimeOwnerInput,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const journal = await readRuntimeJournal(config.journalPath, config.sessionId);
  signal.throwIfAborted();
  const acknowledged = journal.records.find((record) => record.id === `cmd:${input.commandId}`);
  const fact = acknowledged?.facts.find((fact) => fact.type === 'input');
  const value = acknowledged?.result.value as { kind?: string; mode?: string } | undefined;
  if (
    !acknowledged ||
    acknowledged.result.error ||
    value?.kind !== 'owner-input' ||
    value.mode !== input.mode ||
    fact?.type !== 'input' ||
    fact.id !== input.id ||
    fact.turnId !== input.turnId ||
    fact.timestamp !== input.timestamp ||
    !isDeepStrictEqual(fact.input, input.input) ||
    input.input.images?.length ||
    journal.state.closed ||
    journal.state.stopped ||
    !isDeepStrictEqual(journal.state.config?.route, config.route)
  )
    throw new Error('Context preparation requires the current acknowledged text input');
  return journal;
}
