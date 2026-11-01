import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import {
  operationTimeout,
  type AgentSession,
  type RuntimeAcceptanceState,
  type RuntimeProcessIdentity,
} from '@skaro/timeline';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { RuntimeVerificationHost } from '@skaro/agent-runtime';
import type { Services } from '../app-services';
import { c4ReviewKey } from '../c4-review';
import { startBuiltinNativeSession } from '../native/bundled';
import { longContextConfig } from '../credentials/long-context-config';
import { catPilotVerificationTarget } from './task-verification';
import { nativeProbeOptions } from './native-probe-options';
import {
  inspectNativePlanJournal,
  verifyNativePlan,
  verifyNativePlanRestart,
} from './native-verification-plan';

async function invoke(session: AgentSession, id: string, name = 'inspect_acceptance', args = {}) {
  assert('invokeTool' in session && typeof session.invokeTool === 'function');
  return session.invokeTool(name, args, id) as Promise<RuntimeAcceptanceState>;
}

/** Real main → native thread → owned runtime → existing Cat-pilot acceptance service. */
export async function verifyNativeVerification(
  services: Services,
  directory: string,
  owner: RuntimeProcessIdentity,
) {
  const target = await catPilotVerificationTarget(
    services,
    owner,
    'native-cat-pilot-inspection',
    'native-inspection-no-active-run',
  );
  const before = JSON.stringify(await target.context.store.readTask(target.task.id));
  const reviewKey = c4ReviewKey(target.context.id, target.task.id);
  const review = structuredClone(services.db.getSetting(reviewKey, null));
  const config = longContextConfig(directory);
  config.sessionId = target.verification.admission.sessionId;
  config.journalPath = join(directory, 'native-verification.jsonl');
  config.context = undefined;
  config.tools = {
    cwd: target.context.root,
    readDirs: [],
    readOnly: true,
    artifactDir: join(directory, 'native-artifacts'),
    verificationScope: target.verification.scope,
  };
  const entries = resolve('apps/desktop/out/main');
  const { owners, options } = nativeProbeOptions(directory, target.context.root, true);
  let lease = new AbortController();
  let inspectionStarted: (() => void) | undefined;
  const host = (): RuntimeVerificationHost => ({
    ...target.verification,
    signal: lease.signal,
    acceptance: {
      inspect(admission, signal) {
        const started = inspectionStarted;
        inspectionStarted = undefined;
        started?.();
        return target.verification.acceptance.inspect(admission, signal);
      },
    },
  });
  let session: AgentSession | undefined;
  let drain: Promise<void> | undefined;
  const start = async () => {
    session = await startBuiltinNativeSession(
      config,
      join(directory, 'native-attachments'),
      options,
      { verification: host() },
      entries,
    );
    drain = (async () => {
      for await (const _event of session!.events) {
        /* Drain genuine native events. */
      }
    })();
  };
  const close = async () => {
    await session?.close();
    await drain;
    session = undefined;
  };
  try {
    await start();
    const actual = await invoke(session!, 'native-first');
    const expected = await target.verification.acceptance.inspect(
      target.verification.admission,
      new AbortController().signal,
    );
    assert.deepEqual(actual.criteria, expected.criteria);
    assert.deepEqual(actual.binding, expected.binding);
    assert.equal(actual.binding!.execution, 'blocked');
    const plan = await verifyNativePlan(session!, actual);
    await assert.rejects(
      invoke(session!, 'native-widen', 'inspect_acceptance', { projectId: target.context.id }),
      /Invalid arguments/,
    );

    const started = new Promise<void>((resolve) => {
      inspectionStarted = resolve;
    });
    const pending = invoke(session!, 'native-cancel');
    void pending.catch(() => undefined);
    await operationTimeout(started, 10_000, 'Real host inspection did not start');
    await session!.interrupt();
    await assert.rejects(pending);
    await assert.rejects(
      session!.send({ text: 'Resume the read-only native verification after interruption' }),
      /no model request was sent/,
    );
    assert.deepEqual((await invoke(session!, 'native-resumed')).criteria, expected.criteria);

    lease.abort();
    await assert.rejects(
      invoke(session!, 'native-revoked'),
      /Verification host inspection rejected/,
    );
    await close();
    assert.equal(await processBirth(owners[0]!.pid), undefined);
    const count = owners.length;
    await assert.rejects(
      startBuiltinNativeSession(
        config,
        join(directory, 'native-attachments'),
        options,
        {},
        entries,
      ),
      /verification binding/,
    );
    await assert.rejects(
      async () =>
        startBuiltinNativeSession(
          {
            ...config,
            tools: {
              ...config.tools!,
              verificationScope: { ...target.verification.scope, taskId: 'unbound-task' },
            },
          },
          join(directory, 'native-attachments'),
          options,
          { verification: host() },
          entries,
        ),
      /exact host tool scope/,
    );
    assert.equal(owners.length, count);

    lease = new AbortController();
    await start();
    await assert.rejects(
      session!.send({ text: 'Resume the genuine native verification journal after restart' }),
      /no model request was sent/,
    );
    assert.deepEqual((await invoke(session!, 'native-restarted')).criteria, expected.criteria);
    await verifyNativePlanRestart(session!, plan);
    await close();
    const planning = await inspectNativePlanJournal(config.journalPath, plan);
    for (const process of owners) assert.equal(await processBirth(process.pid), undefined);
    assert.equal(owners.length, 2);
    assert.equal(JSON.stringify(await target.context.store.readTask(target.task.id)), before);
    assert.deepEqual(services.db.getSetting(reviewKey, null), review);
    return {
      project: 'Cat-pilot',
      taskId: target.task.id,
      criteria: actual.criteria.length,
      nativeProcesses: owners.length,
      actualServiceProjection: true,
      inFlightCancellation: true,
      resumeAfterInterrupt: true,
      revokedInspectionRejected: true,
      missingHostRejected: true,
      scopeMismatchRejected: true,
      restartWithFreshHost: true,
      exitsConfirmed: true,
      taskAndC4Unchanged: true,
      modelRequests: 0,
      planning,
      journal: config.journalPath,
    };
  } finally {
    await close();
  }
}
