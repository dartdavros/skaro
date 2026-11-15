import { readFileSync } from 'node:fs';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UserInput } from '@skaro/timeline';
import { imageType } from './session-helpers.ts';

/**
 * shouldQuery:false is the SDK's transcript-only contract, including after CLI admission races.
 * It cannot trigger a turn; the SDK guarantees merging into the next querying user message,
 * not regeneration of an already running response.
 */
export function claudeUserMessage(
  input: UserInput,
  uuid: NonNullable<SDKUserMessage['uuid']>,
): SDKUserMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'text', text: input.text },
        ...(input.images ?? []).map((path) => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: imageType(path),
            data: readFileSync(path).toString('base64'),
          },
        })),
      ],
    },
    parent_tool_use_id: null,
    uuid,
    ...(input.onlyActiveTurn ? { shouldQuery: false } : {}),
  };
}
