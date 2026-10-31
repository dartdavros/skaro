import assert from 'node:assert/strict';
import {
  executeChatTurn,
  type ChatRequest,
  type RuntimeSession,
  type OpenRouterConnector,
} from '@skaro/agent-runtime';
import { admitLiveRequest } from './live-budget';

export async function liveCancel(
  session: RuntimeSession,
  connector: OpenRouterConnector,
): Promise<void> {
  if (session.journal.find('proof:cancel')) return;
  let interruption: ReturnType<RuntimeSession['execute']> | undefined;
  const toolsBefore = Object.keys(session.journal.state.toolRequests).length;
  const request: ChatRequest = {
    route: session.journal.state.config!.route,
    price: { prompt: 0.5, completion: 2 },
    messages: [
      {
        role: 'user',
        content: 'Print the integers 1 through 200, one per line, without commentary.',
      },
    ],
  };
  await assert.rejects(
    executeChatTurn({
      id: 'cancel-live',
      session,
      connector,
      request,
      signal: new AbortController().signal,
      maxSteps: 1,
      admitRequest: (_id, current) => admitLiveRequest(session, current),
      onText: () => {
        interruption ??= session.execute({
          id: 'cancel-live-interrupt',
          action: { type: 'interrupt' },
        });
      },
    }),
    /unknown outcome/,
  );
  assert(interruption, 'No genuine streamed text arrived before cancellation');
  assert(!(await interruption).result.error);
  assert.equal(session.journal.state.stopped, true);
  assert.equal(Object.keys(session.journal.state.toolRequests).length, toolsBefore);
  assert.equal(session.journal.state.effects['model-cancel-live-0']?.state, 'unknown');
  await session.journal.append('proof:cancel', [], {
    value: { cancelled: true, lateTools: 0, outcome: 'unknown-not-retried' },
  });
}
