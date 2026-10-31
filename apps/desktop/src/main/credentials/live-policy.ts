import assert from 'node:assert/strict';
import {
  executeChatTurn,
  type OpenRouterConnector,
  type RuntimeSession,
  type ChatRequest,
} from '@skaro/agent-runtime';
import { admitLiveRequest } from './live-budget';

/** A real gateway rejection with require_parameters=true; no fake provider or response. */
export async function livePolicy(
  session: RuntimeSession,
  connector: OpenRouterConnector,
): Promise<void> {
  if (session.journal.find('proof:policy')) return;
  const request: ChatRequest = {
    route: session.journal.state.config!.route,
    price: { prompt: 0.5, completion: 2 },
    messages: [{ role: 'user', content: 'Reply OK.' }],
  };
  await assert.rejects(
    executeChatTurn({
      id: 'policy-live',
      session,
      connector,
      request,
      signal: new AbortController().signal,
      maxSteps: 1,
      admitRequest: (_id, current) => admitLiveRequest(session, current),
    }),
    /rejected \(HTTP (400|404|422)\)/,
  );
  assert.equal(session.journal.state.effects['model-policy-live-0']?.state, 'completed');
  await session.journal.append('proof:policy', [], {
    value: { incompatibleParameterRejected: true, fallback: false },
  });
}
