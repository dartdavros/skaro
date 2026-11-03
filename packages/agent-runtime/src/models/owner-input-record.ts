import type { RuntimeOwnerInput } from '@skaro/timeline';
import type { RuntimeCommand, RuntimeFact } from '../model.ts';

export function ownerInputRecord(command: RuntimeCommand, turnId: string) {
  const { action } = command;
  if (action.type !== 'send' && action.type !== 'steer') throw new Error('Not an owner input');
  if (!action.input.text.trim() && !action.input.images?.length) throw new Error('Input is empty');
  if (action.input.images?.length)
    throw new Error('Image input requires a verified model connector');
  if (Buffer.byteLength(JSON.stringify(action.input)) > 262_144)
    throw new Error('Owner input exceeds the admitted size');
  const input: RuntimeOwnerInput = {
    commandId: command.id,
    id: `input-${command.id}`,
    turnId,
    mode: action.type,
    input: structuredClone(action.input),
    timestamp: Date.now(),
  };
  const facts: RuntimeFact[] = [
    { type: 'input', id: input.id, turnId, input: input.input, timestamp: input.timestamp },
    {
      type: 'timeline',
      event: {
        t: 'item.upsert',
        item: {
          id: input.id,
          turnId,
          startedAt: input.timestamp,
          status: 'done',
          kind: 'message',
          role: 'user',
          text: input.input.text,
          native: { agent: 'skaro', type: 'input', ref: input.id },
        },
      },
    },
  ];
  return { input, facts };
}
