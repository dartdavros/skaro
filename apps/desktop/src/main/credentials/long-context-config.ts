import { join } from 'node:path';
import { BUILTIN_CONTRACT_VERSIONS, DEFAULT_UPSTREAM_POLICY } from '@skaro/timeline';
import type { RuntimeStart } from '@skaro/agent-runtime';

export function longContextConfig(directory: string): RuntimeStart {
  return {
    sessionId: 'long-context-openrouter',
    journalPath: join(directory, 'session-long.jsonl'),
    permissionMode: 'ask',
    versions: BUILTIN_CONTRACT_VERSIONS,
    route: {
      schema: 1,
      routeId: 'long-nano',
      routeRevision: 1,
      connectionId: 'openrouter-owner',
      connectionRevision: 1,
      connector: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1',
      apiProfile: { id: 'openrouter.chat-completions', revision: 1 },
      modelId: 'openai/gpt-4.1-nano',
      parameters: { max_tokens: 2048 },
      upstream: DEFAULT_UPSTREAM_POLICY,
    },
    tools: {
      cwd: process.cwd(),
      readDirs: [],
      readOnly: true,
      artifactDir: join(directory, 'long-context-artifacts'),
    },
    context: {
      scopePath: 'apps/desktop',
      documents: [],
      pins: [
        {
          id: 'direct-live',
          kind: 'decision',
          origin: 'owner',
          revision: 'owner-31-10-2026',
          text: 'Продолжай код прямых коннекторов; живые проверки позже',
        },
      ],
    },
  };
}
