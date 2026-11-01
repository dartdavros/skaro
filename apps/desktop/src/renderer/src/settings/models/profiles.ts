export const CONNECTION_PROFILES = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    profile: 'openrouter.chat-completions',
    endpoint: 'https://openrouter.ai/api/v1',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    profile: 'openai.responses',
    endpoint: 'https://api.openai.com/v1',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    profile: 'anthropic.messages',
    endpoint: 'https://api.anthropic.com/v1',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    profile: 'deepseek.chat-completions',
    endpoint: 'https://api.deepseek.com',
  },
] as const;
export const connectionName = (id: string) =>
  CONNECTION_PROFILES.find((profile) => profile.id === id)?.label ?? id;
