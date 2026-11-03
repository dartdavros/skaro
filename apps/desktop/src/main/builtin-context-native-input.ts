import { createHash } from 'node:crypto';
import { appendNativeOwnerInput, continueContextNativeRequest } from '@skaro/agent-runtime';
import type { ModelTool, NativeRequest, RuntimeModelInputPort } from '@skaro/timeline';
import { ownerInputJournal } from './builtin-owner-input-journal';

/** Main-only native formatting after durable input/process admission. No key access or POST. */
export function createContextNativeInput(options: {
  journalPath: string;
  sessionId: string;
  route: NativeRequest['route'];
  maxSteps: number;
  tools?: readonly ModelTool[];
}): RuntimeModelInputPort {
  const config = structuredClone(options);
  if (!Number.isSafeInteger(config.maxSteps) || config.maxSteps < 1 || config.maxSteps > 100)
    throw new Error('Invalid context input step limit');
  if (
    config.route.apiProfile.revision !== 1 ||
    !(
      (config.route.connector === 'openai' && config.route.apiProfile.id === 'openai.responses') ||
      (config.route.connector === 'anthropic' &&
        config.route.apiProfile.id === 'anthropic.messages')
    )
  )
    throw new Error('Native owner input requires an explicit direct API profile');
  const revision = createHash('sha256')
    .update(JSON.stringify({ schema: 1, formatter: 'context-native-v1', ...config }))
    .digest('hex');
  return {
    revision,
    async prepare(input, signal) {
      const journal = await ownerInputJournal(config, input, signal);
      const request = continueContextNativeRequest(
        { journal },
        {
          route: config.route,
          ...(config.tools ? { tools: config.tools } : {}),
          input: [{ role: 'user', content: input.input.text }],
        },
      );
      signal.throwIfAborted();
      return { request: { kind: 'native', value: request }, maxSteps: config.maxSteps };
    },
    steer: appendNativeOwnerInput,
  };
}
