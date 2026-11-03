import type { ApiProfile, UpstreamPolicy } from './builtin-model.ts';

/** Initial semantic profiles, not a claim that connectors or SDKs are implemented. */
export const BUILTIN_API_PROFILES: readonly ApiProfile[] = Object.freeze(
  [
    {
      id: 'openai.responses',
      revision: 1,
      connector: 'openai',
      protocol: 'responses',
      implementation: 'pending',
    },
    {
      id: 'anthropic.messages',
      revision: 1,
      connector: 'anthropic',
      protocol: 'messages',
      implementation: 'pending',
    },
    {
      id: 'deepseek.chat-completions',
      revision: 1,
      connector: 'deepseek',
      protocol: 'chat-completions',
      implementation: 'pending',
    },
    {
      id: 'openrouter.chat-completions',
      revision: 1,
      connector: 'openrouter',
      protocol: 'chat-completions',
      implementation: 'pending',
    },
  ].map((profile) => Object.freeze(profile as ApiProfile)),
);

export const DEFAULT_UPSTREAM_POLICY: UpstreamPolicy = Object.freeze({
  selection: 'service-default',
  allow: Object.freeze([] as string[]),
  allowFallback: false,
  requireParameters: true,
  dataCollection: 'deny',
});
