import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  appendChatOwnerInput,
  continueContextChatRequest,
  readRuntimeJournal,
} from '@skaro/agent-runtime';
import type { ChatRequest, RuntimeModelInputPort } from '@skaro/timeline';

/** Main-only formatting after the model RPC's durable input/process admission. Never sends bytes. */
export function createContextChatInput(options: {
  journalPath: string;
  sessionId: string;
  route: ChatRequest['route'];
  price: ChatRequest['price'];
  maxSteps: number;
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
      const request = continueContextChatRequest(
        { journal },
        {
          route: config.route,
          price: config.price,
          messages: [{ role: 'user', content: input.input.text }],
        },
      );
      signal.throwIfAborted();
      return { request: { kind: 'chat', value: request }, maxSteps: config.maxSteps };
    },
    steer: appendChatOwnerInput,
  };
}
