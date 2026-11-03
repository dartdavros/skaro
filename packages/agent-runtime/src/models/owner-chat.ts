import type { RuntimeModelInputPort } from '@skaro/timeline';

/** Pure Chat formatting. Existing messages, tool pairs and provider continuation fields stay intact. */
export const appendChatOwnerInput: NonNullable<RuntimeModelInputPort['steer']> = async (
  input,
  request,
  terminal,
  signal,
) => {
  signal.throwIfAborted();
  if (request.kind !== 'chat' || terminal || input.mode !== 'steer' || input.input.images?.length)
    throw new Error('Chat owner steering is incompatible with this input');
  return structuredClone({
    kind: 'chat',
    value: {
      ...request.value,
      messages: [...request.value.messages, { role: 'user', content: input.input.text }],
    },
  });
};
