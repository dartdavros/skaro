import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  RuntimeSession,
  contextChatRequest,
  latestContext,
  executeChatTurn,
  type OpenRouterConnector,
  type RuntimeStart,
  type ChatResponse,
} from '@skaro/agent-runtime';
import {
  BUILTIN_CONTRACT_VERSIONS,
  DEFAULT_UPSTREAM_POLICY,
  type RuntimeProcessIdentity,
} from '@skaro/timeline';
import { admitLiveRequest } from './live-budget';

/** Run only after the owner authorizes the full scoped-instruction payload. No fake backend. */
export async function verifyLiveContext(input: {
  connector: OpenRouterConnector;
  owner: RuntimeProcessIdentity;
  directory: string;
  signal: AbortSignal;
}) {
  const config: RuntimeStart = {
    sessionId: 'context-openrouter',
    journalPath: join(input.directory, 'session-context.jsonl'),
    permissionMode: 'ask',
    versions: BUILTIN_CONTRACT_VERSIONS,
    route: {
      schema: 1,
      routeId: 'context-nano',
      routeRevision: 1,
      connectionId: 'openrouter-owner',
      connectionRevision: 1,
      connector: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1',
      apiProfile: { id: 'openrouter.chat-completions', revision: 1 },
      modelId: 'openai/gpt-4.1-nano',
      parameters: { max_tokens: 256 },
      upstream: DEFAULT_UPSTREAM_POLICY,
    },
    tools: {
      cwd: process.cwd(),
      readDirs: [],
      readOnly: true,
      artifactDir: join(input.directory, 'context-artifacts'),
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
  let session = await RuntimeSession.open(config, input.owner);
  try {
    const proof = session.journal.find('proof:context');
    if (proof) return proof.result.value;
    await session.execute({ id: 'context-refresh', action: { type: 'refreshContext' } });
    const ask = async (id: string): Promise<ChatResponse> => {
      const request = contextChatRequest(session, {
        route: config.route,
        price: { prompt: 0.5, completion: 2 },
        messages: [
          {
            role: 'user',
            content:
              'Какое решение владельца действует для живых проверок прямых OpenAI, Anthropic и DeepSeek? Ответь одной короткой русской фразой. Никаких действий не выполняй.',
          },
        ],
      });
      assert(
        request.messages.every(
          (message) =>
            ['user', 'system'].includes(message.role) &&
            !message.tool_calls &&
            !message.reasoning_details &&
            !message.reasoning_content,
        ),
      );
      const response = await executeChatTurn({
        id,
        session,
        connector: input.connector,
        request,
        signal: input.signal,
        maxSteps: 1,
        admitRequest: (_id, current) => admitLiveRequest(session, current),
      });
      assert.equal(response.finishReason, 'stop');
      assert.match(response.message.content ?? '', /позже|отлож|(?:не|без).*(?:провер|запуск)/i);
      return response;
    };
    const old = latestContext(session.journal)!;
    const before =
      (session.journal.find('model-context-before-0:result')?.result.value as
        ChatResponse | undefined) ?? (await ask('context-before'));
    const records = structuredClone(session.journal.records);
    const compact = await session.execute({ id: 'context-compact', action: { type: 'compact' } });
    assert(!compact.result.error, compact.result.error);
    assert.deepEqual(session.journal.records.slice(0, records.length), records);
    assert.equal(latestContext(session.journal)!.epoch, 1);
    await assert.rejects(
      session.context!.requireCurrent(old.snapshot.revision, 0, input.signal),
      /stale/,
    );
    await session.dispose();
    session = await RuntimeSession.open(config, input.owner);
    assert.equal(latestContext(session.journal)!.epoch, 1);
    const after = await ask('context-after');
    const value = {
      model: config.route.modelId,
      epoch: 1,
      restart: true,
      exactOwnerDecisionPreserved: true,
      requests: 2,
      costUsd:
        before.provenance.usage.cost && after.provenance.usage.cost
          ? Number(before.provenance.usage.cost.amount) + Number(after.provenance.usage.cost.amount)
          : null,
      privateNativeStateForwarded: false,
    };
    await session.journal.append('proof:context', [], { value });
    return value;
  } finally {
    await session.dispose();
  }
}
