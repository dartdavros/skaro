import assert from 'node:assert/strict';
import {
  RuntimeSession,
  latestContext,
  executeChatTurn,
  continueContextChatRequest,
  openRouterCatalog,
  type ChatResponse,
  type ChatRequest,
  type OpenRouterConnector,
} from '@skaro/agent-runtime';
import type { RuntimeProcessIdentity } from '@skaro/timeline';
import { longContextConfig } from './long-context-config';
import {
  auditPrompt,
  longTurn,
  workingSentence,
  requireRecovered,
  RECOVERY_PROMPT,
} from './long-context-work';
import { admitLiveRequest } from './live-budget';

interface Phase {
  owner: RuntimeProcessIdentity;
  expected: string;
  requestBytes: number;
  promptTokens: number;
  turns: number;
}
const changedOwner = (previous: RuntimeProcessIdentity, current: RuntimeProcessIdentity) =>
  previous.pid !== current.pid || previous.birth !== current.birth;
const requestSize = (request: ChatRequest) => Buffer.byteLength(JSON.stringify(request.messages));

/** Real responses only; each compact checkpoint exits the actual Electron host before continuation. */
export async function verifyLongContext(input: {
  connector: OpenRouterConnector;
  owner: RuntimeProcessIdentity;
  directory: string;
  signal: AbortSignal;
}) {
  const catalogue = (await openRouterCatalog('https://openrouter.ai/api/v1', input.signal)) as {
    id: string;
    context_length: number;
    pricing: { prompt: string; completion: string };
  }[];
  assert(
    catalogue.some(
      (model) =>
        model.id === 'openai/gpt-4.1-nano' &&
        model.context_length >= 40_000 &&
        Number(model.pricing.prompt) <= 0.00000015 &&
        Number(model.pricing.completion) <= 0.0000006,
    ),
    'The explicitly selected cheap route is unavailable',
  );
  const session = await RuntimeSession.open(longContextConfig(input.directory), input.owner);
  const journal = session.journal;
  const turn = (id: string, prompt: string, fresh = false) =>
    longTurn({ ...input, session, id, prompt, fresh });
  const progress = (value: unknown) => process.send?.({ type: 'long-progress', value });
  const phase = (index: number) =>
    journal.find(`long:phase:${index}`)?.result.value as Phase | undefined;
  const hypothetical = () =>
    continueContextChatRequest(session, {
      route: journal.state.config!.route,
      price: { prompt: 0.15, completion: 0.6, request: 0 },
      messages: [{ role: 'user', content: RECOVERY_PROMPT }],
    });
  const compact = async (index: number, response: ChatResponse, turns: number) => {
    const before = structuredClone(journal.records);
    const old = latestContext(journal)!;
    const requestBytes = requestSize(hypothetical());
    const result = await session.execute({
      id: `long-compact-${index}`,
      action: { type: 'compact' },
    });
    assert(!result.result.error, result.result.error);
    assert.deepEqual(journal.records.slice(0, before.length), before);
    assert.equal(latestContext(journal)!.epoch, index);
    await assert.rejects(
      session.context!.requireCurrent(old.snapshot.revision, old.epoch, input.signal),
      /stale/,
    );
    const value: Phase = {
      owner: input.owner,
      expected: workingSentence(response),
      requestBytes,
      promptTokens: response.provenance.usage.inputTokens!,
      turns,
    };
    await journal.append(`long:phase:${index}`, [], { value });
    return { complete: false, phase: index, turns, promptTokens: value.promptTokens, requestBytes };
  };
  try {
    const finished = journal.find('proof:long-context');
    if (finished) return { complete: true, proof: finished.result.value };
    if (!latestContext(journal)) {
      const refresh = await session.execute({
        id: 'long-refresh',
        action: { type: 'refreshContext' },
      });
      assert(!refresh.result.error, refresh.result.error);
    }
    const first = phase(1);
    if (!first) {
      let last: ChatResponse | undefined;
      let count = 0;
      for (; count < 48; count++) {
        last = (await turn(`grow-${count}`, auditPrompt(count))).response;
        progress({
          phase: 'grow',
          turn: count + 1,
          promptTokens: last.provenance.usage.inputTokens,
          outputTokens: last.provenance.usage.outputTokens,
          cost: last.provenance.usage.cost!.amount,
        });
        if (count + 1 >= 24 && last.provenance.usage.inputTokens! >= 32_768) {
          count++;
          break;
        }
      }
      assert(
        last && count >= 24 && last.provenance.usage.inputTokens! >= 32_768,
        'Long session threshold was not reached',
      );
      return await compact(1, last, count);
    }
    assert(
      changedOwner(first.owner, input.owner),
      'The actual host process was not restarted after first compact',
    );
    const second = phase(2);
    if (!second) {
      const recovered = await turn('recover-1', RECOVERY_PROMPT, true);
      requireRecovered(recovered.response, first.expected);
      assert(
        recovered.response.provenance.usage.inputTokens! <= first.promptTokens / 2,
        'Compact did not halve reported prompt tokens',
      );
      if (recovered.request) {
        assert(
          requestSize(recovered.request) < first.requestBytes / 2,
          'Compact did not halve actual request bytes',
        );
        await journal.append('long:first-reduction', [], {
          value: {
            beforeTokens: first.promptTokens,
            afterTokens: recovered.response.provenance.usage.inputTokens,
            beforeBytes: first.requestBytes,
            afterBytes: requestSize(recovered.request),
          },
        });
      }
      let last = recovered.response;
      for (let index = 0; index < 4; index++) {
        last = (await turn(`continued-${index}`, auditPrompt(first.turns + index))).response;
        progress({
          phase: 'continued',
          turn: first.turns + index + 1,
          promptTokens: last.provenance.usage.inputTokens,
        });
      }
      return await compact(2, last, first.turns + 5);
    }
    assert(
      changedOwner(second.owner, input.owner),
      'The actual host process was not restarted after second compact',
    );
    const third = journal.find('long:phase:3');
    if (!third) {
      const result = await turn('recover-2-head-v2', RECOVERY_PROMPT, true);
      requireRecovered(result.response, second.expected);
      assert(result.request, 'Final request checkpoint is unavailable');
      await journal.append('long:replay-request', [], { value: result.request });
      await journal.append('long:phase:3', [], { value: { owner: input.owner } });
      return {
        complete: false,
        phase: 3,
        turns: second.turns + 1,
        promptTokens: result.response.provenance.usage.inputTokens,
      };
    }
    assert(
      changedOwner((third.result.value as { owner: RuntimeProcessIdentity }).owner, input.owner),
      'The actual host process was not restarted before replay',
    );
    const original = journal.find('long:replay-request')!.result.value as ChatRequest;
    const before = journal.records.length;
    await executeChatTurn({
      id: 'recover-2-head-v2',
      session,
      connector: input.connector,
      request: original,
      signal: input.signal,
      maxSteps: 1,
      admitRequest: (id, request) => admitLiveRequest(session, request, id),
    });
    assert.equal(
      journal.records.length,
      before,
      'Restart replay produced another effect or model request',
    );
    const responses = journal.records
      .filter((record) => record.id.startsWith('model-') && record.id.endsWith(':result'))
      .map((record) => record.result.value as ChatResponse);
    assert(
      responses.every(
        (response) => response.provenance.actualModel && response.provenance.requestId,
      ),
    );
    assert.equal(
      new Set(responses.map((response) => response.provenance.requestId)).size,
      responses.length,
      'Model request identities were duplicated',
    );
    const owners = [
      first.owner,
      second.owner,
      (third.result.value as { owner: RuntimeProcessIdentity }).owner,
      input.owner,
    ];
    const verifiedRestarts =
      new Set(owners.map((owner) => `${owner.platform}:${owner.pid}:${owner.birth}`)).size - 1;
    assert(verifiedRestarts >= 3, 'Insufficient independently verified process restarts');
    const value = {
      turns: responses.length,
      peakPromptTokens: Math.max(
        ...responses.map((response) => response.provenance.usage.inputTokens!),
      ),
      compactions: 2,
      verifiedProcessRestarts: verifiedRestarts,
      workingNotesRecovered: 2,
      ownerDecisionPreserved: true,
      replayNewRequests: 0,
      reduction: journal.find('long:first-reduction')!.result.value,
      costUsd: responses.reduce(
        (sum, response) => sum + Number(response.provenance.usage.cost!.amount),
        0,
      ),
    };
    await journal.append('proof:long-context', [], { value });
    return { complete: true, proof: value };
  } finally {
    await session.dispose();
  }
}
