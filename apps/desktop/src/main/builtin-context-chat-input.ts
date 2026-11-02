import { createHash } from 'node:crypto';
import { appendChatOwnerInput, continueContextChatRequest } from '@skaro/agent-runtime';
import type { ChatRequest, ModelTool, RuntimeModelInputPort } from '@skaro/timeline';
import { ownerInputJournal } from './builtin-owner-input-journal';

/** Main-only formatting after the model RPC's durable input/process admission. Never sends bytes. */
export function createContextChatInput(options: {
  journalPath: string;
  sessionId: string;
  route: ChatRequest['route'];
  price: ChatRequest['price'];
  maxSteps: number;
  tools?: readonly ModelTool[];
}): RuntimeModelInputPort {
  const config = structuredClone(options);
  if (!Number.isSafeInteger(config.maxSteps) || config.maxSteps < 1 || config.maxSteps > 100)
    throw new Error('Invalid context input step limit');
  const revision = createHash('sha256')
    .update(JSON.stringify({ schema: 1, formatter: 'context-chat-v1', ...config }))
    .digest('hex');
  return {
    revision,
    async prepare(input, signal) {
      const journal = await ownerInputJournal(config, input, signal);
      const request = continueContextChatRequest(
        { journal },
        {
          route: config.route,
          price: config.price,
          ...(config.tools ? { tools: config.tools } : {}),
          messages: [{ role: 'user', content: input.input.text }],
        },
      );
      signal.throwIfAborted();
      return { request: { kind: 'chat', value: request }, maxSteps: config.maxSteps };
    },
    steer: appendChatOwnerInput,
  };
}
