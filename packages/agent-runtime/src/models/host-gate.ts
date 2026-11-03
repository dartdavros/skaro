import type { RuntimeModelBinding, RuntimeModelRequest } from '@skaro/timeline';
import { readRuntimeJournal } from '../journal-reader.ts';
import { fingerprint } from '../verification/inputs.ts';

/** Re-check the actual child journal, not request-supplied claims about its own admission. */
export async function requireModelIntent(
  binding: RuntimeModelBinding,
  id: string,
  request: RuntimeModelRequest,
  dispatch = false,
) {
  if (
    !/^[a-zA-Z0-9_-]{1,160}$/.test(id) ||
    request.kind !== binding.policy.protocol ||
    fingerprint(request.value.route) !== fingerprint(binding.route)
  )
    throw new Error('Model request binding mismatch');
  const { records, state } = await readRuntimeJournal(
    binding.journalPath,
    binding.admission.sessionId,
  );
  const intent = records.find((record) => record.id === `${id}:intent`);
  if ((binding.baseSequence ? records[binding.baseSequence - 1]?.hash : '') !== binding.baseHash)
    throw new Error('Model journal baseline was replaced');
  if (
    !intent ||
    intent.sequence <= binding.baseSequence ||
    state.stopped ||
    state.closed ||
    state.effects[id]?.state !== 'pending' ||
    fingerprint(state.config?.route) !== fingerprint(binding.route) ||
    fingerprint(state.config?.model) !== fingerprint(binding.policy) ||
    !intent.facts.some(
      (fact) =>
        fact.type === 'effect-intent' &&
        fact.id === id &&
        fact.name ===
          (request.kind === 'chat' ? 'model:chat' : `model:${binding.route.apiProfile.id}`),
    )
  )
    throw new Error('No current durable model intent');
  if (dispatch) {
    const record = records.find((record) => record.id === `${id}:dispatch`);
    const value = record?.result.value as
      | {
          requestHash?: string;
          bindingHash?: string;
          reservation?: { sequence: number; hash: string };
        }
      | undefined;
    const reserved = value?.reservation && records[value.reservation.sequence - 1];
    if (
      !record ||
      record.sequence <= intent.sequence ||
      value?.requestHash !== fingerprint(request) ||
      value.bindingHash !== fingerprint(binding) ||
      !reserved ||
      reserved.id !== `budget:${id}` ||
      reserved.hash !== value.reservation?.hash ||
      reserved.sequence <= intent.sequence ||
      reserved.sequence >= record.sequence
    )
      throw new Error('Model dispatch lacks its durable reservation');
  }
}
