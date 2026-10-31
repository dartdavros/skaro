import { app } from 'electron';
import { join } from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {
  RuntimeSession,
  restoreRuntime,
  OpenRouterConnector,
  openRouterCatalog,
  type JournalRecord,
} from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import {
  BUILTIN_CONTRACT_VERSIONS,
  DEFAULT_UPSTREAM_POLICY,
  type RouteSnapshot,
} from '@skaro/timeline';
import { ModelCredentialVault } from './vault';
import { liveChain, liveReplay, liveRequest } from './live-cases';
import { liveCancel } from './live-cancel';
import { livePolicy } from './live-policy';
import { verifyLiveContext } from './context-live';

// Real-service acceptance entry; no HTTP server, fake API, renderer, or plaintext key input.
app.setName('Skaro');
void app.whenReady().then(async () => {
  let vault: ModelCredentialVault | undefined;
  let session: RuntimeSession | undefined;
  let stage = 'credential';
  const controller = new AbortController();
  try {
    const reference = { id: process.argv[2]!, revision: Number(process.argv[3]) };
    assert(reference.id && Number.isSafeInteger(reference.revision) && reference.revision > 0);
    const directory = join(app.getPath('userData'), 'verification/openrouter-ba4');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    vault = new ModelCredentialVault(join(app.getPath('userData'), 'credentials'));
    const birth = await processBirth(process.pid);
    assert(birth);
    const owner = { pid: process.pid, birth, platform: process.platform };
    const admission = {
      id: `live-${process.pid}-${birth}`,
      sessionId: 'openrouter-ba4',
      generation: 1,
    };
    const binding = {
      connectionId: 'openrouter-owner',
      connectionRevision: 1,
      endpoint: 'https://openrouter.ai/api/v1',
    };
    const auth = { binding, reference, admission };
    const credentials = vault.port(
      auth,
      {
        async requireActive(value, signal) {
          signal.throwIfAborted();
          assert.deepEqual(value, admission);
          assert.equal(await processBirth(owner.pid), owner.birth);
          signal.throwIfAborted();
        },
      },
      controller.signal,
    );
    const connector = new OpenRouterConnector(credentials, auth);
    const before = await connector.limits(controller.signal);
    process.send?.({ type: 'limits', before });
    if (process.argv[4] === '--context') {
      stage = 'context';
      const proof = await verifyLiveContext({
        connector,
        owner,
        directory,
        signal: controller.signal,
      });
      const after = await connector.limits(controller.signal);
      process.send?.({ type: 'context', proof });
      process.send?.({ type: 'limits', after });
      await vault.close();
      vault = undefined;
      process.send?.({ type: 'complete', directory }, () => app.exit(0));
      return;
    }
    assert(
      before.remainingUsd === null || before.remainingUsd >= 0.5,
      'Insufficient authorized test budget',
    );
    stage = 'catalog';
    const catalogue = (await openRouterCatalog(binding.endpoint, AbortSignal.timeout(20_000))) as {
      id: string;
      supported_parameters: string[];
      pricing: { prompt: string; completion: string };
    }[];
    // Explicit catalogue-checked acceptance cases, not a runtime fallback chain.
    const models = ['openai/gpt-4.1-nano', 'anthropic/claude-haiku-5.5'].map((id) =>
      catalogue.find(
        (model) =>
          model.id === id &&
          model.supported_parameters.includes('tools') &&
          model.supported_parameters.includes('tool_choice') &&
          Number(model.pricing.prompt) > 0 &&
          Number(model.pricing.prompt) <= 0.0000005 &&
          Number(model.pricing.completion) > 0 &&
          Number(model.pricing.completion) <= 0.000002,
      ),
    );
    assert(
      models.every(Boolean),
      'Two affordable model namespaces are unavailable; no model substitution',
    );
    const route = (id: string): RouteSnapshot => ({
      schema: 1,
      routeId: id.replaceAll('/', '-'),
      routeRevision: 1,
      connectionId: binding.connectionId,
      connectionRevision: binding.connectionRevision,
      connector: 'openrouter',
      endpoint: binding.endpoint,
      apiProfile: { id: 'openrouter.chat-completions', revision: 1 },
      modelId: id,
      parameters: { max_tokens: 512 },
      upstream: DEFAULT_UPSTREAM_POLICY,
    });
    let failures = 0;
    for (let index = 0; index < models.length; index++) {
      const selected = route(models[index]!.id);
      const journalPath = join(directory, `session-${index === 0 ? 'openai' : 'anthropic'}.jsonl`);
      let config = {
        sessionId: `${admission.sessionId}-${index}`,
        journalPath,
        route: selected,
        permissionMode: 'ask' as const,
        versions: BUILTIN_CONTRACT_VERSIONS,
        tools: {
          cwd: process.cwd(),
          readDirs: [],
          readOnly: true,
          artifactDir: join(directory, 'artifacts'),
        },
      };
      try {
        const records = (await readFile(journalPath, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line)) as JournalRecord[];
        config = restoreRuntime(records).config! as typeof config;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      session = await RuntimeSession.open(config, owner);
      try {
        stage = `chain-${index}`;
        assert.deepEqual(
          session.journal.state.config!.route,
          selected,
          'Configured case route changed',
        );
        const request = liveRequest(session);
        process.send?.({ type: 'selected', model: selected.modelId });
        const proof = await liveChain(session, connector, `chain-${index}-terminal-v2`, request);
        process.send?.({ type: 'chain', proof });
        stage = `recovery-${index}`;
        const persisted = structuredClone(session.journal.state.config!);
        await session.dispose();
        session = await RuntimeSession.open(persisted, owner);
        await liveReplay(session, connector, `chain-${index}-terminal-v2`, request);
        process.send?.({ type: 'replay', model: selected.modelId, newRequests: 0 });
      } catch {
        failures++;
        const failure = session.journal.records.findLast(
          (record) => record.id.startsWith('model-') && record.id.endsWith(':failed'),
        );
        process.send?.({
          type: 'case-failed',
          model: selected.modelId,
          stage,
          reason: failure?.result.error ?? 'Live contract assertion failed',
        });
      }
      await session.dispose();
      session = undefined;
    }
    for (const check of ['cancel', 'policy'] as const) {
      stage = check;
      const selected = route(check === 'cancel' ? models[0]!.id : models[1]!.id);
      if (check === 'policy') selected.parameters = { max_tokens: 16, top_p: 0.23 };
      session = await RuntimeSession.open(
        {
          sessionId: `${admission.sessionId}-${check}`,
          journalPath: join(directory, `session-${check}.jsonl`),
          route: selected,
          permissionMode: 'ask',
          versions: BUILTIN_CONTRACT_VERSIONS,
        },
        owner,
      );
      try {
        if (check === 'cancel') await liveCancel(session, connector);
        else await livePolicy(session, connector);
        process.send?.({
          type: check,
          proof: session.journal.find(`proof:${check}`)?.result.value,
        });
      } catch {
        failures++;
        const failure = session.journal.records.findLast((record) => record.id.endsWith(':failed'));
        process.send?.({
          type: 'case-failed',
          stage,
          reason: failure?.result.error ?? 'Live contract assertion failed',
        });
      }
      await session.dispose();
      session = undefined;
    }
    const after = await connector.limits(controller.signal);
    process.send?.({
      type: 'limits',
      after,
      deltaUsd:
        before.usageUsd !== null && after.usageUsd !== null
          ? after.usageUsd - before.usageUsd
          : null,
    });
    await vault.close();
    vault = undefined;
    process.send?.({ type: 'complete', directory, failures }, () => app.exit(failures ? 1 : 0));
  } catch {
    controller.abort();
    await session?.dispose();
    await vault?.close();
    process.send?.({ type: 'failed', stage }, () => app.exit(1));
  }
});
