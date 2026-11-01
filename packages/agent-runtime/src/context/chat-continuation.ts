import type { ChatMessage, ChatRequest } from '../models/chat-types.ts';
import { contextChatRequest, type ContextSelection, type ContextJournalView } from './request.ts';

/** Continue only the exact route/context epoch; compact starts a fresh native conversation. */
export function continueContextChatRequest(
  session: ContextJournalView,
  request: ChatRequest,
): ChatRequest {
  const fresh = contextChatRequest(session, request);
  const stored = session.journal.state.continuation;
  const value = stored?.value as
    { schema?: number; context?: ContextSelection; messages?: ChatMessage[] } | undefined;
  if (
    !stored ||
    JSON.stringify(stored.route) !== JSON.stringify(request.route) ||
    value?.schema !== 1 ||
    value.context?.revision !== fresh.context!.revision ||
    value.context?.epoch !== fresh.context!.epoch ||
    JSON.stringify(value.messages?.[0]) !== JSON.stringify(fresh.messages[0])
  )
    return fresh;
  if (
    Object.keys(session.journal.state.interactions).length ||
    Object.values(session.journal.state.effects).some((effect) => effect.state !== 'completed')
  )
    throw new Error('Unresolved work prevents native chat continuation');
  if (!Array.isArray(value.messages)) throw new Error('Invalid saved chat continuation');
  const open = new Set<string>();
  for (const message of value.messages) {
    if (!['system', 'user', 'assistant', 'tool'].includes(message.role))
      throw new Error('Invalid saved chat role');
    if (message.role === 'tool') {
      if (!message.tool_call_id || !open.delete(message.tool_call_id))
        throw new Error('Unmatched saved tool result');
    } else {
      if (open.size) throw new Error('Saved native tool calls have no complete results');
      for (const call of message.tool_calls ?? []) {
        if (!call.id || open.has(call.id)) throw new Error('Invalid saved tool call identity');
        open.add(call.id);
      }
    }
  }
  if (open.size) throw new Error('Saved native tool calls have no complete results');
  return structuredClone({ ...fresh, messages: [...value.messages, ...request.messages] });
}
