import assert from 'node:assert/strict';
import { basename, join, resolve } from 'node:path';
import { operationTimeout, type AgentSession, type RuntimeProcessIdentity } from '@skaro/timeline';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { Services } from '../app-services';
import { NativeAdmissions } from '../native/admissions';
import { AdmissionStore } from '../native/admission-state';
import { startBuiltinNativeSession } from '../native/bundled';
import { nativeProbeConfig, nativeProbeOptions } from './native-probe-options';
import { c4ReviewKey } from '../c4-review';
import { nativeOperationBootstrap } from './native-operation-bootstrap';
import { configuredCredentialProbe } from './configured-credentials';

/** Persist real process admissions on the registered project; never create a TaskRun. */
export async function verifyNativeAdmissions(
  services: Services,
  directory: string,
  _owner: RuntimeProcessIdentity,
  configuredCredentials = false,
) {
  const projects = services.db.shell
    .list()
    .filter((project) => project.name.toLowerCase() === 'cat-pilot');
  assert.equal(projects.length, 1);
  const context = services.projects.get(projects[0]!.id);
  const task = await context.store.readTask('T-008');
  const before = JSON.stringify(task);
  const reviewKey = c4ReviewKey(context.id, task.id);
  const review = structuredClone(services.db.getSetting(reviewKey, null));
  const scope = {
    kind: 'task' as const,
    projectId: context.id,
    taskId: task.id,
    runId: 'durable-admission-no-active-run',
  };
  const sessionId = 'native-durable-admission';
  const ownerKey = `verification:${basename(directory)}`;
  const store = new AdmissionStore(services.db, ownerKey);
  const credentials = configuredCredentials ? await configuredCredentialProbe(services) : undefined;
  const prepare = () =>
    NativeAdmissions.prepare({
      db: services.db,
      ownerKey,
      sessionId,
      scope,
      signal: new AbortController().signal,
      async requireCurrent(signal) {
        signal.throwIfAborted();
        assert.equal(services.db.getProject(context.id)?.id, context.id);
        assert.equal((await context.store.readTask(task.id)).id, task.id);
        signal.throwIfAborted();
      },
    });
  let lease = await prepare();
  let operations = await nativeOperationBootstrap(services, scope, lease);
  const firstAdmission = lease.admission;
  assert.equal(store.read()?.status, 'prepared');
  await assert.rejects(
    lease.requireActive(firstAdmission, new AbortController().signal),
    /not active/,
  );
  await assert.rejects(prepare(), /no confirmed exit/);
  await assert.rejects(
    NativeAdmissions.recover(services.db, ownerKey, new AbortController().signal),
    /host is still alive/,
  );
  const config = nativeProbeConfig(directory, context.root, sessionId, true);
  config.tools!.verificationScope = scope;
  config.extensions = operations.bound.extensions.tools.map(({ name, revision, readOnly }) => ({
    name,
    revision,
    readOnly,
  }));
  const { owners, options } = nativeProbeOptions(directory, context.root, true);
  const recordOwner = options.processStarted!;
  options.processStarted = (pid, identity) => {
    assert(identity);
    recordOwner(pid, identity);
    lease.recordOwnership({ pid, ...identity });
  };
  let session: AgentSession | undefined;
  let drain: Promise<void> | undefined;
  const start = async () => {
    session = await startBuiltinNativeSession(
      config,
      join(directory, 'native-attachments'),
      options,
      {
        signal: lease.signal,
        extensions: operations.bound,
        verification: {
          scope,
          admission: lease.admission,
          acceptance: services.runs.builtinAcceptance(scope, lease),
        },
      },
      resolve('apps/desktop/out/main'),
    );
    const actual = session;
    drain = (async () => {
      for await (const _event of actual.events) {
        /* Genuine native events. */
      }
    })();
  };
  const inspect = async (id: string) => {
    assert(session && 'invokeTool' in session && typeof session.invokeTool === 'function');
    const state = (await session.invokeTool('inspect_acceptance', {}, id)) as {
      criteria: unknown[];
      binding: { execution: string };
    };
    assert.equal(state.criteria.length, 9);
    assert.equal(state.binding.execution, 'blocked');
    await operations.requireActive();
    const result = (await session.invokeTool(operations.name, {}, `${id}-context`)) as {
      text: string;
    };
    assert(result.text.includes(projects[0]!.name));
  };
  const close = async () => {
    await session?.close();
    await drain;
    session = undefined;
  };
  try {
    await credentials?.prepared(lease);
    await start();
    assert.equal(store.read()?.status, 'active');
    assert.deepEqual(store.read()?.owner, owners[0]);
    await lease.requireActive(firstAdmission, new AbortController().signal);
    await credentials?.active(lease);
    await assert.rejects(
      lease.requireActive(
        { ...firstAdmission, generation: firstAdmission.generation + 1 },
        new AbortController().signal,
      ),
      /stale/,
    );
    await inspect('initial');
    const old = lease;
    await lease.revoke(firstAdmission, 'Explicit native verification handoff');
    credentials?.revoked();
    await operations.requireRevoked();
    assert.equal(store.read()?.status, 'revoked');
    await assert.rejects(prepare(), /no confirmed exit/);
    await operationTimeout(drain!, 45_000, 'Revoked durable admission did not close its runtime');
    await close();
    await Promise.all([lease.confirmExit(firstAdmission), lease.confirmExit(firstAdmission)]);
    assert.equal(store.read()?.status, 'exited');
    for (const process of owners) assert.equal(await processBirth(process.pid), undefined);

    lease = await prepare();
    operations = await nativeOperationBootstrap(services, scope, lease);
    assert.equal(lease.admission.generation, firstAdmission.generation + 1);
    assert.notEqual(lease.admission.id, firstAdmission.id);
    await assert.rejects(old.revoke(firstAdmission, 'Must not revoke the successor'), /stale/);
    await assert.rejects(old.confirmExit(firstAdmission), /stale/);
    await credentials?.prepared(lease);
    await start();
    await assert.rejects(
      session!.send({ text: 'Resume with the fresh durable native admission only' }),
      /no model request was sent/,
    );
    await lease.requireActive(lease.admission, new AbortController().signal);
    await credentials?.active(lease);
    await inspect('successor');
    assert.equal(store.read()?.status, 'active');
    await credentials?.shutdownWhileActive(lease);
    await lease.revoke(lease.admission, 'Native verification completed');
    await operations.requireRevoked();
    await close();
    await lease.confirmExit(lease.admission);
    assert.equal(store.read()?.status, 'exited');
    for (const process of owners) assert.equal(await processBirth(process.pid), undefined);
    assert.equal(owners.length, 2);
    assert.equal(JSON.stringify(await context.store.readTask(task.id)), before);
    assert.deepEqual(services.db.getSetting(reviewKey, null), review);
    return {
      project: 'Cat-pilot',
      taskId: task.id,
      durableOwnershipBeforeInspection: true,
      actualCatalogueBeforeSpawn: true,
      bootstrapCannotExecute: true,
      catalogueMatchesActivePort: true,
      handlerRequiresLiveLease: true,
      metadataCannotMutateRegistry: true,
      preparedLeaseCannotAct: true,
      liveHostRecoveryRejected: true,
      previousExitRequired: true,
      generationAdvanced: true,
      staleOwnerCannotRevokeSuccessor: true,
      concurrentExitConfirmation: true,
      automaticRevokedExit: true,
      nativeProcesses: owners.length,
      exitsConfirmed: true,
      taskAndC4Unchanged: true,
      modelRequests: 0,
      ...(credentials ? { credentials: credentials.proof() } : {}),
      finalGeneration: lease.admission.generation,
      status: store.read()?.status,
      journal: config.journalPath,
    };
  } finally {
    credentials?.close();
    await lease.revoke(lease.admission, 'Native verification cleanup');
    await close();
    await lease.confirmExit(lease.admission);
  }
}
