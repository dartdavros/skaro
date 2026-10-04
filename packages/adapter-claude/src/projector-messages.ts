import { arr, num, obj, str, type Obj } from '@skaro/timeline';
import { AGENT, textOf, errorCategory } from './projector-helpers.ts';
import type { ClaudeProjectionState } from './projector-state.ts';

export class ClaudeMessagesProjection {
  private readonly state: ClaudeProjectionState;
  constructor(state: ClaudeProjectionState) {
    this.state = state;
  }
  onAssistant(msg: Obj): void {
    if (!this.state.turnOpen) this.state.startTurn();
    if (!msg['parent_tool_use_id']) this.state.markQueuedDone();
    const message = obj(msg['message']);
    const messageId = str(message?.['id']) ?? str(msg['uuid']) ?? '';
    const parentId = str(msg['parent_tool_use_id']);
    const error = str(msg['error']);
    if (error)
      this.state.turnError = { category: errorCategory(error), message: textOf(message) || error };

    const usage = obj(msg['context_usage']);
    if (usage) {
      this.state.emit({
        t: 'usage',
        inputTokens: num(usage['total_tokens']) ?? 0,
        outputTokens: 0,
        contextWindow: num(usage['raw_max_tokens']),
        contextUsedPct: num(usage['percentage']),
      });
    }
    // Context fill: what the model saw for the latest main-thread reply.
    const messageUsage = obj(message?.['usage']);
    if (messageUsage && !parentId) {
      this.state.contextTokens =
        (num(messageUsage['input_tokens']) ?? 0) +
        (num(messageUsage['cache_read_input_tokens']) ?? 0) +
        (num(messageUsage['cache_creation_input_tokens']) ?? 0) +
        (num(messageUsage['output_tokens']) ?? 0);
    }

    for (const raw of arr(message?.['content'])) {
      const block = obj(raw);
      if (!block) continue;
      const blockType = str(block['type']) ?? '';
      const id = this.state.blockId(messageId, blockType, block, true);
      const native = { agent: AGENT, type: `assistant.${blockType}`, ref: id };
      switch (blockType) {
        case 'text': {
          const text = str(block['text']) ?? '';
          // Synthetic error messages (e.g. "Not logged in") become the turn error, not agent text.
          if (error) {
            this.state.notice(
              id,
              'error',
              error === 'rate_limit'
                ? 'rate_limit'
                : errorCategory(error) === 'auth'
                  ? 'auth'
                  : 'other',
              text,
            );
            break;
          }
          this.state.upsert({
            id,
            parentId,
            kind: 'message',
            role: 'agent',
            text,
            phase: 'commentary',
            status: 'done',
            native,
          });
          if (!parentId) this.state.turnMessages.push(id);
          break;
        }
        case 'thinking':
          this.state.upsert({
            id,
            parentId,
            kind: 'reasoning',
            text: str(block['thinking']) ?? '',
            status: 'done',
            native,
          });
          break;
        case 'redacted_thinking':
          this.state.upsert({
            id,
            parentId,
            kind: 'reasoning',
            redacted: true,
            status: 'done',
            native,
          });
          break;
        case 'tool_use':
          this.state.tools.onToolUse(block, parentId);
          break;
        default:
          this.state.upsert({ id, parentId, kind: 'unknown', raw: block, status: 'done', native });
      }
    }
  }
}
