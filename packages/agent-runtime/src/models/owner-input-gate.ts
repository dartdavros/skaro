import type { RuntimeModelBinding, RuntimeOwnerInput } from '@skaro/timeline';
import { readRuntimeJournal } from '../journal-reader.ts';
import { fingerprint } from '../verification/inputs.ts';

/** Read the real acknowledged input. RPC callers cannot substitute their own input or revision. */
export async function requireOwnerInput(binding: RuntimeModelBinding, commandId: string) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(commandId) || !binding.policy.input?.revision)
    throw new Error('Owner input preparation is not configured');
  const { records, state } = await readRuntimeJournal(
    binding.journalPath,
    binding.admission.sessionId,
  );
  const record = records.find((record) => record.id === `cmd:${commandId}`);
  const value = record?.result.value as
    { kind?: string; mode?: string; modelTurnId?: string } | undefined;
  const fact = record?.facts.find((fact) => fact.type === 'input');
  if (
    !record ||
    record.sequence <= binding.baseSequence ||
    (binding.baseSequence ? records[binding.baseSequence - 1]?.hash : '') !== binding.baseHash ||
    state.closed ||
    state.stopped ||
    fingerprint(state.config?.model) !== fingerprint(binding.policy) ||
    fingerprint(state.config?.route) !== fingerprint(binding.route) ||
    value?.kind !== 'owner-input' ||
    !value.modelTurnId ||
    records.some((record) => record.id === `cmd:${value.modelTurnId}`) ||
    !['send', 'steer'].includes(value.mode ?? '') ||
    fact?.type !== 'input' ||
    record.requestHash !== fingerprint({ type: value.mode, input: fact.input })
  )
    throw new Error('No current durable owner input');
  return {
    commandId,
    id: fact.id,
    turnId: fact.turnId,
    mode: value.mode,
    input: structuredClone(fact.input),
    timestamp: fact.timestamp,
  } as RuntimeOwnerInput;
}
