import type { RuntimeModelBinding, RuntimeModelResponse } from '@skaro/timeline';
import { ownerSteeringInvocation } from './host-schemas.ts';
import { requireOwnerInput } from './owner-input-gate.ts';
import { fingerprint } from '../verification/inputs.ts';
import { readRuntimeJournal } from '../journal-reader.ts';

export async function requireOwnerSteering(binding: RuntimeModelBinding, raw: unknown) {
  const args = ownerSteeringInvocation.parse(raw);
  const input = await requireOwnerInput(binding, args.id);
  const request = structuredClone((raw as typeof args).request);
  if (
    input.mode !== 'steer' ||
    request.kind !== binding.policy.protocol ||
    fingerprint(request.value.route) !== fingerprint(binding.route)
  )
    throw new Error('Steering differs from its owner input binding');
  if (!args.responseId) return { input, request, terminal: undefined };
  const journal = await readRuntimeJournal(binding.journalPath, binding.admission.sessionId);
  const ack = journal.records.find((record) => record.id === `cmd:${input.commandId}`)!;
  const modelId = (ack.result.value as { modelTurnId: string }).modelTurnId;
  const result = journal.records.find((record) => record.id === `${args.responseId}:result`);
  const response = { kind: request.kind, value: result?.result.value } as RuntimeModelResponse;
  if (
    !args.responseId.startsWith(`native-${modelId}-`) ||
    !result ||
    result.result.error ||
    result.sequence <= binding.baseSequence ||
    !response.value ||
    fingerprint(response.value.provenance.route) !== fingerprint(binding.route)
  )
    throw new Error('Steering terminal output has no current durable source');
  return { input, request, terminal: { requestId: args.responseId, response } };
}
