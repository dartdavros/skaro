import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { bindSkaroOperations } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import {
  operationTimeout,
  type AgentSession,
  type RuntimeProcessIdentity,
  type RuntimeScopedExtensionHost,
} from '@skaro/timeline';
import type { Services } from '../app-services';
import { c4ReviewKey } from '../c4-review';
import { longContextConfig } from '../credentials/long-context-config';
import { startBuiltinNativeSession } from '../native/bundled';
import { nativeProbeOptions } from './native-probe-options';

/** Actual Cat-pilot handlers through main → native thread → owned runtime. No model or TaskRun. */
export async function verifyNativeOperations(
  services: Services,
  directory: string,
  owner: RuntimeProcessIdentity,
) {
  const projects = services.db.shell
    .list()
    .filter((item) => item.name.toLowerCase() === 'cat-pilot');
  assert.equal(projects.length, 1);
  const context = services.projects.get(projects[0]!.id);
  const task = await context.store.readTask('T-008');
  const before = JSON.stringify(task);
  const reviewKey = c4ReviewKey(context.id, task.id);
  const review = structuredClone(services.db.getSetting(reviewKey, null));
  const scope = { kind: 'project_chat' as const, projectId: context.id };
  const admission = {
    id: `native-operations-${owner.pid}`,
    sessionId: 'native-operations',
    generation: 1,
  };
  const port = services.mcp.operations(scope, {
    async requireActive(value, signal) {
      signal.throwIfAborted();
      assert.deepEqual(value, admission);
      assert.equal(await processBirth(owner.pid), owner.birth);
      signal.throwIfAborted();
    },
  });
  let lease = new AbortController();
  let operationStarted: (() => void) | undefined;
  const allowed = [{ name: 'get_project_context', readOnly: false }];
  const host = async (): Promise<RuntimeScopedExtensionHost> => {
    const actual = await bindSkaroOperations(port, admission, allowed, lease.signal);
    return {
      scope,
      admission,
      signal: lease.signal,
      extensions: {
        ...actual,
        tools: actual.tools.map((tool) => ({
          ...tool,
          invoke(id, args, signal) {
            const started = operationStarted;
            operationStarted = undefined;
            started?.();
            return tool.invoke(id, args, signal);
          },
        })),
      },
    };
  };
  let bound = await host();
  const config = longContextConfig(directory);
  config.sessionId = admission.sessionId;
  config.journalPath = join(directory, 'native-operations.jsonl');
  config.context = undefined;
  config.tools = {
    cwd: context.root,
    readDirs: [],
    readOnly: false,
    artifactDir: join(directory, 'operation-artifacts'),
  };
  config.extensions = bound.extensions.tools.map(({ name, revision, readOnly }) => ({
    name,
    revision,
    readOnly,
  }));
  const toolName = bound.extensions.tools[0]!.name;
  const { owners, records, options } = nativeProbeOptions(directory, context.root, false);
  const entries = resolve('apps/desktop/out/main');
  let session: AgentSession | undefined;
  let drain: Promise<void> | undefined;
  let approved: string | undefined;
  let approvals = 0;
  const start = async () => {
    session = await startBuiltinNativeSession(
      config,
      join(directory, 'native-attachments'),
      options,
      { extensions: bound },
      entries,
    );
    const actual = session;
    drain = (async () => {
      for await (const event of actual.events) {
        if (event.t !== 'interaction.opened' || event.interaction.kind !== 'approval') continue;
        if (
          [...records.values()]
            .flatMap((record) => record.facts)
            .some((fact) => fact.type === 'answer' && fact.interactionId === event.interaction.id)
        )
          continue;
        assert(approved);
        assert.equal(event.interaction.id, `approval-${approved}`);
        assert.equal(event.interaction.action.title, toolName);
        assert(![...records.values()].some((record) => record.id === `intent:${approved}`));
        approvals++;
        await actual.respond(event.interaction.id, { kind: 'approval', choice: 'allow_once' });
      }
    })();
    void drain.catch(() => {
      void actual.interrupt().catch(() => undefined);
    });
  };
  const close = async () => {
    await session?.close();
    await drain;
    session = undefined;
  };
  const call = async (id: string, name = toolName, args: unknown = {}, approve = false) => {
    assert(session && 'invokeTool' in session && typeof session.invokeTool === 'function');
    approved = approve ? id : undefined;
    const count = approvals;
    try {
      return await session.invokeTool(name, args, id);
    } finally {
      if (approve) assert.equal(approvals, count + 1);
      approved = undefined;
    }
  };
  try {
    await start();
    const result = (await call('context', toolName, {}, true)) as { text: string };
    assert(result.text.includes(projects[0]!.name));
    const direct = await port.execute({
      admission,
      callId: 'direct-context',
      name: 'get_project_context',
      args: {},
      signal: lease.signal,
    });
    assert.deepEqual(result, direct);
    const count = records.size;
    assert.deepEqual(await call('context'), result);
    assert.equal(records.size, count);
    await assert.rejects(call('widen', toolName, { projectId: 'outside' }), /Invalid extension/);
    await assert.rejects(call('outside', 'mcp__skaro__submit_result'), /Unknown tool/);
    assert(
      ![...records.values()].some(
        (record) => record.id === 'intent:widen' || record.id === 'intent:outside',
      ),
    );

    await session!.interrupt();
    await assert.rejects(
      session!.send({ text: 'Resume the native host transport verification only' }),
      /no model request was sent/,
    );
    assert.deepEqual(await call('resumed', toolName, {}, true), result);
    await close();
    assert.equal(await processBirth(owners[0]!.pid), undefined);
    const spawned = owners.length;
    await assert.rejects(
      async () =>
        startBuiltinNativeSession(
          config,
          join(directory, 'native-attachments'),
          { ...options, processStarted: undefined },
          { extensions: bound },
          entries,
        ),
      /durable process ownership callback/,
    );
    await assert.rejects(
      startBuiltinNativeSession(
        config,
        join(directory, 'native-attachments'),
        options,
        {},
        entries,
      ),
      /extension binding/,
    );
    await assert.rejects(
      async () =>
        startBuiltinNativeSession(
          { ...config, extensionsScope: { ...scope, kind: 'integration' } },
          join(directory, 'native-attachments'),
          options,
          { extensions: bound },
          entries,
        ),
      /exact host scope/,
    );
    assert.equal(owners.length, spawned);
    await assert.rejects(
      startBuiltinNativeSession(
        { ...config, extensions: config.extensions!.map((tool) => ({ ...tool, readOnly: true })) },
        join(directory, 'native-attachments'),
        options,
        { extensions: bound },
        entries,
      ),
      /extension binding/,
    );
    assert.equal(owners.length, spawned);
    await assert.rejects(
      startBuiltinNativeSession(
        config,
        join(directory, 'native-attachments'),
        options,
        { extensions: { ...bound, scope: { ...scope, kind: 'integration' } } },
        entries,
      ),
      /Resume extension scope/,
    );

    lease = new AbortController();
    bound = await host();
    await start();
    await assert.rejects(
      session!.send({ text: 'Resume genuine native operations history after restart' }),
      /no model request was sent/,
    );
    assert.deepEqual(await call('context'), result);
    assert.deepEqual(await call('after-restart', toolName, {}, true), result);
    const started = new Promise<void>((resolve) => {
      operationStarted = resolve;
    });
    const pending = call('revoked', toolName, {}, true);
    void pending.catch(() => undefined);
    await operationTimeout(started, 20_000, 'Real host operation did not start');
    lease.abort();
    await assert.rejects(pending, /no confirmed outcome/);
    const revokedCount = records.size;
    await assert.rejects(call('revoked'), /no confirmed outcome/);
    assert.equal(records.size, revokedCount);
    assert(
      [...records.values()]
        .flatMap((record) => record.facts)
        .some((fact) => fact.type === 'effect-unknown' && fact.id === 'revoked'),
    );
    await close();
    for (const process of owners) assert.equal(await processBirth(process.pid), undefined);
    assert.equal(owners.length, 3);
    assert.equal(JSON.stringify(await context.store.readTask(task.id)), before);
    assert.deepEqual(services.db.getSetting(reviewKey, null), review);
    assert(
      ![...records.values()]
        .flatMap((record) => record.facts)
        .some((fact) => fact.type === 'process'),
    );
    return {
      project: 'Cat-pilot',
      actualHandlers: true,
      exactDirectResult: true,
      approvalsBeforeIntent: approvals,
      scopeAndSchemaRejected: true,
      restartRequiresHost: true,
      durableOwnerRequired: true,
      changedPolicyRejected: true,
      persistedScopeChangeRejected: true,
      resumeAfterInterrupt: true,
      replayWithoutDispatch: true,
      revokedOutcomeUnknown: true,
      inFlightRevocation: true,
      revokedReplayBlocked: true,
      nativeProcesses: owners.length,
      exitsConfirmed: true,
      taskAndC4Unchanged: true,
      modelRequests: 0,
      checkProcesses: 0,
      journal: config.journalPath,
    };
  } finally {
    await close();
    await bound.extensions.close();
  }
}
