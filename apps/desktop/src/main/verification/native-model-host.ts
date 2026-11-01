import assert from 'node:assert/strict';
import { readRuntimeJournal, type OpenRouterConnector } from '@skaro/agent-runtime';
import type { RuntimeModelHost, RuntimeProcessIdentity, ChatRequest } from '@skaro/timeline';
import type { Services } from '../app-services';
import { quoteLiveRequest, requireLiveBudget } from '../credentials/live-budget';
import { catPilotVerificationTarget } from './task-verification';
import { nativeProbeConfig } from './native-probe-options';
import {
  MODEL_PLAN_REJECTION,
  modelPlanInspection,
  modelPlanPayload,
  modelPlanToolAdmission,
  planPayloadHash,
} from './model-plan-request';

/** No approval => real admission refusal. The connector is always the actual configured service. */
export async function nativePlanHost(
  services: Services,
  directory: string,
  owner: RuntimeProcessIdentity,
  connector: OpenRouterConnector,
  approvalHash?: string,
) {
  const target = await catPilotVerificationTarget(
    services,
    owner,
    'native-model-cat-pilot',
    'verification-model-plan-no-active-run',
  );
  const config = nativeProbeConfig(
    directory,
    target.context.root,
    approvalHash ? 'session-nativeplan' : 'native-model-preflight',
    true,
  );
  config.sessionId = target.verification.admission.sessionId;
  config.tools!.verificationScope = target.verification.scope;
  const signal = new AbortController().signal;
  const current = await target.verification.acceptance.inspect(
    target.verification.admission,
    signal,
  );
  const payload = modelPlanPayload(current, config.route);
  if (approvalHash)
    assert.equal(planPayloadHash(payload), approvalHash, 'Approved task payload changed');
  const tools = modelPlanToolAdmission(payload.inspection);
  config.model = {
    scope: target.verification.scope,
    protocol: 'chat',
    tools: {
      revision: tools.revision,
      selectChatTools: true,
      chatToolsRequired: tools.chatToolsRequired,
      rejectionMessage: tools.rejectionMessage,
    },
  };
  const previous = await readRuntimeJournal(config.journalPath, config.sessionId, true);
  let requests = 0;
  const allowed = async (request: ChatRequest, signal: AbortSignal) => {
    assert(approvalHash, 'No reviewed payload admission was provided');
    assert.equal(planPayloadHash(request.route), planPayloadHash(payload.request.route));
    assert.deepEqual(request.price, payload.request.price);
    assert.deepEqual(
      request.messages.slice(0, payload.request.messages.length),
      payload.request.messages,
    );
    for (const tool of request.tools ?? [])
      assert(
        payload.request.tools!.some((entry) => planPayloadHash(entry) === planPayloadHash(tool)),
      );
    for (const message of request.messages) {
      if (message.role !== 'tool') continue;
      assert.equal(typeof message.content, 'string');
      const value = JSON.parse(message.content!);
      if (value.error) {
        assert.deepEqual(Object.keys(value), ['error']);
        assert(
          [MODEL_PLAN_REJECTION, 'Tool is not in the admitted model catalogue'].includes(
            value.error,
          ),
        );
      }
    }
    const latest = await target.verification.acceptance.inspect(
      target.verification.admission,
      signal,
    );
    assert.equal(planPayloadHash(modelPlanInspection(latest)), planPayloadHash(payload.inspection));
    assert.equal(planPayloadHash(modelPlanPayload(latest, config.route)), approvalHash);
  };
  const model: RuntimeModelHost = {
    scope: target.verification.scope,
    admission: target.verification.admission,
    journalPath: config.journalPath,
    route: config.route,
    baseSequence: previous.records.length,
    baseHash: previous.records.at(-1)?.hash ?? '',
    policy: config.model,
    toolAdmission: tools,
    reserve: async (id, request, signal) => {
      assert.equal(request.kind, 'chat');
      if (request.kind !== 'chat') throw new Error('The reviewed plan uses the chat protocol');
      await allowed(request.value, signal);
      return { ...quoteLiveRequest(request.value, id) };
    },
    complete: async (_id, request, signal, onText) => {
      assert.equal(request.kind, 'chat');
      if (request.kind !== 'chat') throw new Error('The reviewed plan uses the chat protocol');
      await allowed(request.value, signal);
      await requireLiveBudget(directory);
      signal.throwIfAborted();
      requests++;
      return { kind: 'chat', value: await connector.complete(request.value, signal, onText) };
    },
  };
  return { target, config, model, payload, requestCount: () => requests };
}
