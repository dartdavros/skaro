import assert from 'node:assert/strict';
import { app, type Session } from 'electron';
import { join } from 'node:path';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { RuntimeProcessIdentity, ChatResponse } from '@skaro/timeline';
import type { Services } from '../app-services';
import { NativeAdmissions } from '../native/admissions';
import { c4ReviewKey } from '../c4-review';
import { nativeProbeConfig, nativeProbeOptions } from './native-probe-options';
import { configuredNativeSession } from './configured-native-session';
import { readConfiguredPlanReview } from './configured-plan-review';
import { configuredPlanPolicy } from './configured-plan-policy';
import { configuredPlanTurn } from './configured-plan-turn';
import { modelPlanToolAdmission } from './model-plan-request';
import { requireConfiguredPlanBudget } from './configured-plan-budget';
import { verifyModelTimeline } from './model-timeline-proof';
import { configuredPlanHistory } from './configured-plan-history';

/** Live mode requires a separately owner-approved payload hash and five-intent budget extension. */
export async function verifyConfiguredPlanLive(
  services: Services,
  directory: string,
  data: string,
  owner: RuntimeProcessIdentity,
  path: string,
  hash: string,
) {
  const { reviewed, target, configuration } = await readConfiguredPlanReview(
    services,
    data,
    owner,
    path,
    hash,
  );
  const ledger = join(data, 'verification/openrouter-ba4');
  const journalName = `session-configured-${reviewed.attemptId}.jsonl`;
  const beforeHistory = await configuredPlanHistory(ledger, journalName);
  const beforeTask = JSON.stringify(target.task);
  const reviewKey = c4ReviewKey(target.context.id, target.task.id);
  const beforeReview = structuredClone(services.db.getSetting(reviewKey, null));
  const beforeRuns = services.db.listRuns(target.context.id, target.task.id);
  const scope = target.verification.scope;
  const ownerKey = `verification:configured-plan:${reviewed.attemptId}`;
  const lease = await NativeAdmissions.prepare({
    db: services.db,
    ownerKey,
    scope,
    sessionId: `configured-${reviewed.attemptId}`,
    signal: new AbortController().signal,
    async requireCurrent(signal) {
      signal.throwIfAborted();
      assert.equal(JSON.stringify(await target.context.store.readTask(target.task.id)), beforeTask);
      assert.deepEqual(services.db.getSetting(reviewKey, null), beforeReview);
      signal.throwIfAborted();
    },
  });
  const config = nativeProbeConfig(ledger, target.context.root, lease.admission.sessionId, true);
  config.journalPath = join(ledger, journalName);
  config.route = reviewed.request.route;
  config.tools!.verificationScope = scope;
  const tools = modelPlanToolAdmission(reviewed.inspection);
  config.model = {
    scope,
    protocol: 'chat',
    input: { revision: hash },
    tools: {
      revision: tools.revision,
      selectChatTools: true,
      chatToolsRequired: true,
      rejectionMessage: tools.rejectionMessage,
    },
  };
  const policy = configuredPlanPolicy(services, owner, reviewed, ledger);
  const turn = configuredPlanTurn(
    config.journalPath,
    config.sessionId,
    hash,
    reviewed.request.messages[0]!.content!,
  );
  const { owners, options } = nativeProbeOptions(directory, target.context.root, true);
  let posts = 0;
  const sessions: Session[] = [];
  const observe = (network: Session) => {
    sessions.push(network);
    network.webRequest.onBeforeRequest(
      { urls: ['https://openrouter.ai/api/v1/chat/completions'] },
      (details, callback) => {
        if (details.method === 'POST') posts++;
        callback({ cancel: false });
      },
    );
  };
  app.on('session-created', observe);
  let generation: Awaited<ReturnType<typeof configuredNativeSession>> | undefined;
  try {
    generation = await configuredNativeSession({
      services,
      config,
      lease,
      options,
      directory,
      requests: policy.requests,
      toolAdmission: tools,
      observe: turn.observe,
      ownerInput: {
        revision: hash,
        async prepare(input, signal) {
          signal.throwIfAborted();
          assert.deepEqual(input.input, { text: reviewed.request.messages[0]!.content });
          return {
            request: { kind: 'chat', value: structuredClone(reviewed.request) },
            maxSteps: 5,
          };
        },
      },
    });
    const result = await turn.run(await generation.start());
    for (const name of ['inspect_acceptance', 'plan_checks', 'assess_checks'])
      assert(
        result.journal.records.some((record) =>
          record.facts.some(
            (fact) =>
              fact.type === 'tool-request' &&
              fact.name === name &&
              result.journal.state.effects[fact.id]?.state === 'completed',
          ),
        ),
      );
    const assessment = result.journal.records.findLast((record) =>
      record.id.startsWith('verification-assessment:'),
    );
    assert.equal((assessment?.result.value as { readyToSubmit?: boolean })?.readyToSubmit, false);
    const responses = result.journal.records
      .filter(
        (record) => record.id.startsWith(`model-${result.id}-`) && record.id.endsWith(':result'),
      )
      .map((record) => record.result.value as ChatResponse);
    const text = result.journal.records
      .filter((record) => record.id.startsWith(`model-text:${result.id}:`))
      .map((record) => (record.result.value as { text: string }).text)
      .join('');
    assert(responses.length > 0 && text.length > 0);
    assert.equal(text, responses.map((response) => response.message.content ?? '').join(''));
    assert(posts <= 5);
    if (posts) assert.equal(responses.length, posts);
    assert.equal(policy.counts().dispatchPermits, posts);
    await generation.close();
    for (const child of owners) assert.equal(await processBirth(child.pid), undefined);
    assert.equal(JSON.stringify(await target.context.store.readTask(target.task.id)), beforeTask);
    assert.deepEqual(services.db.getSetting(reviewKey, null), beforeReview);
    assert.deepEqual(services.db.listRuns(target.context.id, target.task.id), beforeRuns);
    assert.deepEqual(services.modelConfiguration.read(), configuration);
    assert.deepEqual(await configuredPlanHistory(ledger, journalName), beforeHistory);
    const final = await readRuntimeJournal(config.journalPath, config.sessionId);
    return {
      project: 'Cat-pilot',
      taskId: target.task.id,
      payloadHash: hash,
      modelPostAttempts: posts,
      budget: await requireConfiguredPlanBudget(ledger, reviewed.budget),
      originalHoldsRetained: true,
      actualConfiguredHost: true,
      sharedVaultOwner: true,
      ordinarySend: true,
      stableInputDedup: true,
      olderJournalBytesUnchanged: true,
      replayOnly: posts === 0,
      readyToSubmit: false,
      noTaskRunCreated: true,
      taskC4ConfigurationUnchanged: true,
      exitsConfirmed: true,
      timeline: verifyModelTimeline(final.records, generation.events, result.id, 'done', text),
      journal: config.journalPath,
    };
  } finally {
    try {
      await generation?.close();
    } finally {
      try {
        await lease.revoke(lease.admission, 'Configured live plan finished');
        await lease.confirmExit(lease.admission);
      } finally {
        app.removeListener('session-created', observe);
        for (const network of sessions) network.webRequest.onBeforeRequest(null);
      }
    }
  }
}
