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
import type { AgentSession, ChatResponse, RuntimeProcessIdentity } from '@skaro/timeline';
import { AppState } from '../state';
import { createServices, type Services } from '../app-services';
import { closeBackground } from '../background/client';
import { c4ReviewKey } from '../c4-review';
import { startBuiltinNativeSession } from '../native/bundled';
import { nativeProbeOptions } from './native-probe-options';
import { nativePlanHost } from './native-model-host';
import { planPayloadHash } from './model-plan-request';

/** The previously reviewed Cat-pilot payload, now through genuine owned native/runtime processes. */
export async function verifyNativeModelPlan(input: {
  connector: OpenRouterConnector;
  owner: RuntimeProcessIdentity;
  directory: string;
  payloadPath: string;
  expectedHash: string;
  signal: AbortSignal;
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
  const state = new AppState(join(data, 'skaro.db'));
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
    drain = (async () => {
      for await (const _event of actual.events) {
        /* Genuine native events. */
      }
    })();
    const prior = await readRuntimeJournal(prepared.config.journalPath, prepared.config.sessionId);
    if (prior.state.closed || prior.state.stopped)
      await assert.rejects(
        session.send({ text: 'Resume the reviewed native plan verification only' }),
        /no model request was sent/,
      );
    assert('runModelTurn' in session && typeof session.runModelTurn === 'function');
    const id = `nativeplan-${input.expectedHash.slice(0, 16)}-v1`;
    const request = { kind: 'chat' as const, value: prepared.payload.request };
    const response = (await session.runModelTurn(request, id, 6)) as ChatResponse;
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
    assert.deepEqual(await session.runModelTurn(request, id, 6), response);
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
    return {
      project: 'Cat-pilot',
      taskId: prepared.target.task.id,
      payloadHash: input.expectedHash,
      nativeProcesses: owners.length,
      exitsConfirmed: true,
      requests: responses.length,
      streamingTextPersisted: true,
      toolsAndProjectionsInHost: true,
      durableBudgetBeforePost: true,
      duplicateTurnNoPost: true,
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
