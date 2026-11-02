import type { RuntimeModelInputPort } from '@skaro/timeline';
import { continueNativeConversation } from './native-continuation.ts';
import { requireDirectProfile } from './direct-request.ts';

/** Keep native reasoning/tool items intact when new owner text reaches a safe model boundary. */
export const appendNativeOwnerInput: NonNullable<RuntimeModelInputPort['steer']> = async (
  input,
  request,
  terminal,
  signal,
) => {
  signal.throwIfAborted();
  if (request.kind !== 'native' || input.mode !== 'steer' || input.input.images?.length)
    throw new Error('Native owner steering is incompatible with this input');
  const openAI = request.value.route.apiProfile.id === 'openai.responses';
  requireDirectProfile(
    request.value.route,
    openAI ? 'openai' : 'anthropic',
    openAI ? 'openai.responses' : 'anthropic.messages',
  );
  let value = request.value;
  if (terminal) {
    if (terminal.response.kind !== 'native' || terminal.response.value.calls.length)
      throw new Error('Native steering requires a completed terminal response');
    value = continueNativeConversation(value, terminal.response.value);
  }
  signal.throwIfAborted();
  return structuredClone({
    kind: 'native',
    value: { ...value, input: [...value.input, { role: 'user', content: input.input.text }] },
  });
};
