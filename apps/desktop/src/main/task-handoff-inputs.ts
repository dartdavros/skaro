import { isDeepStrictEqual } from 'node:util';
import type { MessageInput } from '../shared/ipc';

/** Startup may have consumed the queue's in-memory batch before preparation failed. */
export function handoffInputs(...batches: readonly MessageInput[][]): MessageInput[] {
  const combined: MessageInput[] = [];
  for (const input of batches.flat()) {
    const existing =
      input.commandId && combined.find((entry) => entry.commandId === input.commandId);
    if (existing) {
      if (!isDeepStrictEqual(existing, input)) throw new Error('Conflicting pending owner input');
    } else combined.push(structuredClone(input));
  }
  return combined;
}
