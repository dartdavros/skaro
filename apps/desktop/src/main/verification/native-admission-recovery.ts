import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { operationTimeout, type AgentSession, type RuntimeProcessIdentity } from '@skaro/timeline';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';
import { processBirth, stopOwnedProcess } from '../process-identity';
import type { Services } from '../app-services';
import { NativeAdmissions } from '../native/admissions';
import { AdmissionStore } from '../native/admission-state';
import { startBuiltinNativeSession } from '../native/bundled';
import { nativeProbeConfig, nativeProbeOptions } from './native-probe-options';
import { c4ReviewKey } from '../c4-review';

/** Real host exit, actual saved ownership and successor runtime on the registered Cat-pilot. */
export async function verifyNativeAdmissionRecovery(
  services: Services,
  data: string,
  directory: string,
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
  const ownerKey = `recovery:${basename(directory)}`;
  const store = new AdmissionStore(services.db, ownerKey);
  const entries = resolve('apps/desktop/out/main');
  const child = fork(
    join(entries, 'verify-admission-host.cjs'),
    [join(data, 'skaro.db'), directory, context.id, ownerKey],
    {
      execArgv: [],
      env: { ...cleanCommandEnvironment(), ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
      serialization: 'advanced',
    },
  );
  const exited = new Promise<number | null>((resolve) => child.once('close', resolve));
  let hostOwner: RuntimeProcessIdentity | undefined;
  let successor: NativeAdmissions | undefined;
  let session: AgentSession | undefined;
  let drain: Promise<void> | undefined;
  try {
    assert(child.pid);
    // Register IPC listeners before waiting for the asynchronous OS identity query.
    const birth = processBirth(child.pid);
    void birth.catch(() => undefined);
    const ready = await operationTimeout(
      new Promise<{
        host: RuntimeProcessIdentity;
        owner: RuntimeProcessIdentity;
      }>((resolve, reject) => {
        child.once('error', reject);
        child.once(
          'message',
          (message: {
            type?: string;
            host: RuntimeProcessIdentity;
            owner: RuntimeProcessIdentity;
          }) => {
            if (message.type !== 'admission-host-ready')
              reject(new Error('Actual admission host did not initialize'));
            else resolve(message);
          },
        );
        child.once('close', () => reject(new Error('Admission host exited before ready')));
      }),
      45_000,
      'Real admission host did not become ready',
    );
    const measuredBirth = await birth;
    assert(measuredBirth);
    hostOwner = { pid: child.pid, birth: measuredBirth, platform: process.platform };
    assert.deepEqual(ready.host, hostOwner);
    assert.equal(store.read()?.status, 'active');
    assert.deepEqual(store.read()?.owner, ready.owner);
    await assert.rejects(
      NativeAdmissions.recover(services.db, ownerKey, new AbortController().signal),
      /host is still alive/,
    );
    child.send({ type: 'exit-host' });
    assert.equal(await operationTimeout(exited, 30_000, 'Host did not exit'), 73);
    assert.equal(await processBirth(hostOwner.pid), undefined);
    assert.equal(store.read()?.status, 'active'); // Actual durable state left by the abruptly exited host.
    const runtimeAliveBeforeRecovery = (await processBirth(ready.owner.pid)) === ready.owner.birth;
    await NativeAdmissions.recover(services.db, ownerKey, new AbortController().signal);
    assert.equal(store.read()?.status, 'exited');
    assert.equal(await processBirth(ready.owner.pid), undefined);
    await NativeAdmissions.recover(services.db, ownerKey, new AbortController().signal);
    successor = await NativeAdmissions.prepare({
      db: services.db,
      ownerKey,
      sessionId: 'native-admission-recovery',
      scope: { kind: 'project_chat', projectId: context.id },
      signal: new AbortController().signal,
      async requireCurrent(signal) {
        signal.throwIfAborted();
        assert.equal(services.db.getProject(context.id)?.id, context.id);
      },
    });
    assert.equal(successor.admission.generation, 2);
    const config = nativeProbeConfig(directory, context.root, 'native-admission-recovery', true);
    const { options, owners } = nativeProbeOptions(directory, context.root, true);
    const recordOwner = options.processStarted!;
    options.processStarted = (pid, identity) => {
      assert(identity);
      recordOwner(pid, identity);
      successor!.recordOwnership({ pid, ...identity });
    };
    session = await startBuiltinNativeSession(
      config,
      join(directory, 'native-attachments'),
      options,
      { signal: successor.signal },
      entries,
    );
    const actual = session;
    drain = (async () => {
      for await (const _event of actual.events) {
        /* Actual native events. */
      }
    })();
    await successor.requireActive(successor.admission, new AbortController().signal);
    assert('invokeTool' in session && typeof session.invokeTool === 'function');
    const result = (await session.invokeTool(
      'find_files',
      { pattern: 'index.html' },
      'after-host-recovery',
    )) as { files: string[] };
    assert(result.files.includes('index.html'));
    await successor.revoke(successor.admission, 'Recovery verification completed');
    await session.close();
    await drain;
    session = undefined;
    await successor.confirmExit(successor.admission);
    for (const owner of owners) assert.equal(await processBirth(owner.pid), undefined);
    assert.equal(JSON.stringify(await context.store.readTask(task.id)), before);
    assert.deepEqual(services.db.getSetting(reviewKey, null), review);
    return {
      project: 'Cat-pilot',
      abruptHostExit: true,
      actualSavedActiveAdmission: true,
      liveHostRecoveryRejected: true,
      runtimeAliveBeforeRecovery,
      recoveryConfirmedExit: true,
      repeatedRecoveryIdempotent: true,
      successorGeneration: successor.admission.generation,
      genuineRuntimeReadsBeforeAndAfter: true,
      runtimeProcesses: owners.length + 1,
      exitsConfirmed: true,
      taskAndC4Unchanged: true,
      modelRequests: 0,
      journal: config.journalPath,
    };
  } finally {
    if (hostOwner) await stopOwnedProcess(hostOwner);
    else child.kill();
    await operationTimeout(exited, 15_000, 'Recovery host cleanup did not exit');
    if (successor) await successor.revoke(successor.admission, 'Recovery verification cleanup');
    await session?.close();
    await drain;
    if (successor) await successor.confirmExit(successor.admission);
    else await NativeAdmissions.recover(services.db, ownerKey, new AbortController().signal);
  }
}
