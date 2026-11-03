import assert from 'node:assert/strict';
import { app } from 'electron';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  readRuntimeJournal,
  openRouterCatalog,
  type OpenRouterConnector,
} from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type {
  AgentSession,
  ChatResponse,
  RuntimeProcessIdentity,
  TimelineEvent,
} from '@skaro/timeline';
import { operationTimeout } from '@skaro/timeline';
import { catPilotState } from './cat-pilot-state';
import { createServices, type Services } from '../app-services';
import { closeBackground } from '../background/client';
import { c4ReviewKey } from '../c4-review';
import { startBuiltinNativeSession } from '../native/bundled';
import { nativeProbeOptions } from './native-probe-options';
import { nativePlanHost } from './native-model-host';
import { planPayloadHash } from './model-plan-request';
import { verifyModelTimeline } from './model-timeline-proof';
import { nativePlanTurn } from './native-plan-turn';

/** The previously reviewed Cat-pilot payload, now through genuine owned native/runtime processes. */
export async function verifyNativeModelPlan(input: {
  connector: OpenRouterConnector;
  owner: RuntimeProcessIdentity;
  directory: string;
  payloadPath: string;
  expectedHash: string;
  signal: AbortSignal;
  ownerInput?: boolean;
}) {
  assert(/^[a-f0-9]{64}$/.test(input.expectedHash));
  assert(app.requestSingleInstanceLock(), 'Skaro is already running');
  const data = app.getPath('userData');
  const root = await realpath(join(data, 'verification'));
  const path = await realpath(input.payloadPath);
  const rel = relative(root, path);
  const stat = await lstat(input.payloadPath);
  assert(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 65_536);
  assert.equal(planPayloadHash(JSON.parse(await readFile(path, 'utf8'))), input.expectedHash);
  assert.equal(
    await realpath(input.directory),
    await realpath(join(data, 'verification/openrouter-ba4')),
  );
  const state = catPilotState(data);
  let services: Services | undefined;
  let session: AgentSession | undefined;
  let drain: Promise<void> | undefined;
  try {
    services = await createServices(state, data, () => undefined);
    const prepared = await nativePlanHost(
      services,
      input.directory,
      input.owner,
      input.connector,
      input.expectedHash,
      input.ownerInput,
    );
    const catalogue = (await openRouterCatalog(prepared.config.route.endpoint, input.signal)) as {
      id: string;
      supported_parameters: string[];
      pricing: { prompt: string; completion: string };
    }[];
    assert(
      catalogue.some(
        (model) =>
          model.id === prepared.config.route.modelId &&
          model.supported_parameters.includes('tools') &&
          model.supported_parameters.includes('tool_choice') &&
          Number(model.pricing.prompt) >= 0 &&
          Number(model.pricing.prompt) <= 0.0000005 &&
          Number(model.pricing.completion) >= 0 &&
          Number(model.pricing.completion) <= 0.000002,
      ),
    );
    const before = JSON.stringify(prepared.target.task);
    const reviewKey = c4ReviewKey(prepared.target.context.id, prepared.target.task.id);
    const review = structuredClone(services.db.getSetting(reviewKey, null));
    const { owners, options } = nativeProbeOptions(
      input.directory,
      prepared.target.context.root,
      true,
    );
    session = await startBuiltinNativeSession(
      prepared.config,
      join(input.directory, 'native-attachments'),
      options,
      { verification: prepared.target.verification, model: prepared.model, signal: input.signal },
      resolve('apps/desktop/out/main'),
    );
    const actual = session;
    const events: TimelineEvent[] = [];
    const terminalWaiters = new Map<string, () => void>();
    drain = (async () => {
      for await (const event of actual.events) {
        events.push(event);
        if (event.t === 'turn.completed') terminalWaiters.get(event.turnId)?.();
      }
    })();
    const prior = await readRuntimeJournal(prepared.config.journalPath, prepared.config.sessionId);
    if (!input.ownerInput && (prior.state.closed || prior.state.stopped))
      await assert.rejects(
        session.send({ text: 'Resume the reviewed native plan verification only' }),
        /no model request was sent/,
      );
    const request = { kind: 'chat' as const, value: prepared.payload.request };
    const { id, response, duplicate } = await nativePlanTurn(
      session,
      prepared.config,
      request,
      input.expectedHash,
      !!input.ownerInput,
      (turnId) =>
        operationTimeout(
          new Promise<void>((resolve) => {
            if (events.some((event) => event.t === 'turn.completed' && event.turnId === turnId))
              resolve();
            else terminalWaiters.set(turnId, resolve);
          }),
          540_000,
          'Ordinary owner model turn did not finish',
        ),
    );
    assert.equal(response.finishReason, 'stop');
    const snapshot = await readRuntimeJournal(
      prepared.config.journalPath,
      prepared.config.sessionId,
    );
    const results = snapshot.records.filter(
      (record) => record.id.startsWith(`model-${id}-`) && record.id.endsWith(':result'),
    );
    const responses = results.map((record) => record.result.value as ChatResponse);
    assert(responses.length > 0);
    assert(
      responses.every((result) => result.provenance.actualModel && result.provenance.usage.cost),
    );
    assert.equal(prepared.requestCount(), responses.length);
    for (const name of ['inspect_acceptance', 'plan_checks', 'assess_checks'])
      assert(
        snapshot.records.some(
          (record) =>
            record.facts.some((fact) => fact.type === 'tool-request' && fact.name === name) &&
            snapshot.state.effects[record.facts.find((fact) => fact.type === 'tool-request')!.id]
              ?.state === 'completed',
        ),
      );
    const assessment = snapshot.records.findLast((record) =>
      record.id.startsWith('verification-assessment:'),
    );
    assert.equal((assessment?.result.value as { readyToSubmit: boolean }).readyToSubmit, false);
    const text = snapshot.records
      .filter((record) => record.id.startsWith(`model-text:${id}:`))
      .map((record) => (record.result.value as { text: string }).text)
      .join('');
    assert(text.length > 0);
    assert.equal(text, responses.map((result) => result.message.content ?? '').join(''));
    assert.deepEqual(await duplicate(), response);
    assert.equal(
      (await readRuntimeJournal(prepared.config.journalPath, prepared.config.sessionId)).records
        .length,
      snapshot.records.length,
    );
    assert.equal(prepared.requestCount(), responses.length);
    assert(!Object.keys(snapshot.state.processes).length);
    assert.equal(
      JSON.stringify(await prepared.target.context.store.readTask(prepared.target.task.id)),
      before,
    );
    assert.deepEqual(services.db.getSetting(reviewKey, null), review);
    await session.close();
    await drain;
    session = undefined;
    for (const owner of owners) assert.equal(await processBirth(owner.pid), undefined);
    const final = await readRuntimeJournal(prepared.config.journalPath, prepared.config.sessionId);
    const timeline = verifyModelTimeline(final.records, events, id, 'done', text);
    return {
      project: 'Cat-pilot',
      taskId: prepared.target.task.id,
      payloadHash: input.expectedHash,
      nativeProcesses: owners.length,
      exitsConfirmed: true,
      requests: responses.length,
      streamingTextPersisted: true,
      timeline,
      toolsAndProjectionsInHost: true,
      durableBudgetBeforePost: true,
      duplicateTurnNoPost: true,
      ...(input.ownerInput
        ? {
            ordinarySend: true,
            exactDurableOwnerInput: true,
            preparations: prepared.preparationCount(),
          }
        : {}),
      readyToSubmit: false,
      taskAndC4Unchanged: true,
      checkProcesses: 0,
      journal: prepared.config.journalPath,
      notice: 'Native model planning, not accepted task execution or submission',
    };
  } finally {
    await session?.close();
    await drain;
    if (services) {
      await services.modelCatalog.close();
      await services.modelSettings.close();
      await Promise.allSettled([
        services.runs.close(),
        services.chats.close(),
        services.mcp.close(),
        services.graph.close(),
        services.ci.close(),
      ]);
      services.projects.close();
    }
    await closeBackground();
    state.db.close();
  }
}
