import assert from 'node:assert/strict';
import {
  executeChatTurn,
  toolCatalog,
  type ChatRequest,
  type ChatResponse,
  type OpenRouterConnector,
  type RuntimeSession,
} from '@skaro/agent-runtime';
import { admitLiveRequest } from './live-budget';
import { liveToolAdmission } from './live-tool-authority';
import { OpenRouterStream } from '../../../../../packages/agent-runtime/src/models/openrouter-stream';

export function liveRequest(session: RuntimeSession): ChatRequest {
  const read = toolCatalog().find((tool) => tool.name === 'read_file')!;
  return {
    route: session.journal.state.config!.route,
    price: { prompt: 0.5, completion: 2 },
    tools: [
      {
        name: read.name,
        description:
          'Read a real scoped project file. Errors are authoritative; do not retry denied paths.',
        parameters: read.inputSchema,
      },
    ],
    messages: [
      {
        role: 'user',
        content:
          'This is an authorized read-only integration check in the real Skaro repository. Call read_file three times, sequentially: first AGENTS.md (maxLines 2), then package.json (maxLines 3), then .git/HEAD (maxLines 1). The last call must demonstrate the actual scope denial; report its error without retrying. After the three results, answer with a brief summary. Do not use any other path or tool. Do not invent file contents or tool results.',
      },
    ],
  };
}

export async function liveChain(
  session: RuntimeSession,
  connector: OpenRouterConnector,
  id: string,
  request: ChatRequest,
) {
  let streamed = 0;
  const response = await executeChatTurn({
    id,
    session,
    connector,
    request,
    signal: new AbortController().signal,
    maxSteps: 5,
    admitRequest: (_id, current) => admitLiveRequest(session, current),
    toolAdmission: liveToolAdmission,
    onText: (text) => {
      streamed += text.length;
    },
  });
  assert.equal(response.finishReason, 'stop');
  assert(streamed > 0 || session.journal.find(`proof:${id}`), 'No streamed model text');
  const responses = session.journal.records
    .filter((record) => record.id.startsWith(`model-${id}-`) && record.id.endsWith(':result'))
    .map((record) => record.result.value as ChatResponse);
  const calls = responses.flatMap((result) => result.message.tool_calls ?? []);
  assert(calls.length >= 3, 'Model did not complete all real tool calls');
  assert(calls.every((call) => call.function.name === 'read_file'));
  assert(responses.every((result) => result.provenance.requestId && result.provenance.actualModel));
  assert(
    responses.every((result) => result.provenance.usage.cost !== null),
    'Reported request cost is missing',
  );
  const continuation = session.journal.state.continuation?.value as {
    messages: { role: string; content: string }[];
  };
  assert(
    continuation.messages.some(
      (message) => message.role === 'tool' && message.content.includes('error'),
    ),
    'The real tool denial was not returned to the model',
  );
  await session.journal.append(`proof:${id}`, [], {
    value: {
      model: request.route.modelId,
      requests: responses.length,
      tools: calls.length,
      upstreams: [...new Set(responses.map((result) => result.provenance.upstream))],
      costUsd: responses.reduce(
        (sum, result) => sum + Number(result.provenance.usage.cost!.amount),
        0,
      ),
      streamedCharacters: streamed,
    },
  });
  return session.journal.find(`proof:${id}`)!.result.value;
}

export async function liveReplay(
  session: RuntimeSession,
  connector: OpenRouterConnector,
  id: string,
  request: ChatRequest,
) {
  // Reparse genuine committed provider deltas, without API substitutes or extra requests.
  for (const record of session.journal.records) {
    if (!record.id.startsWith(`model-${id}-`) || !record.id.endsWith(':result')) continue;
    const response = record.result.value as ChatResponse;
    const stream = new OpenRouterStream();
    for (const event of response.native) stream.push(event);
    assert.equal(stream.requireComplete(), response.finishReason);
    assert.deepEqual(stream.message, response.message);
    assert.deepEqual(stream.usage, response.provenance.usage);
  }
  const before = session.journal.records.length;
  await executeChatTurn({
    id,
    session,
    connector,
    request,
    signal: new AbortController().signal,
    maxSteps: 5,
    admitRequest: (_id, current) => admitLiveRequest(session, current),
    toolAdmission: liveToolAdmission,
  });
  assert.equal(
    session.journal.records.length,
    before,
    'Replay appended a new effect or charged request',
  );
}
