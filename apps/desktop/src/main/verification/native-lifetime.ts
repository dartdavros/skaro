import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  operationTimeout,
  type AgentSession,
  type RuntimeAcceptanceState,
  type RuntimeProcessIdentity,
} from '@skaro/timeline';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { Services } from '../app-services';
import { c4ReviewKey } from '../c4-review';
import { startBuiltinNativeSession } from '../native/bundled';
import { nativeProbeConfig, nativeProbeOptions } from './native-probe-options';
import { catPilotVerificationTarget } from './task-verification';

async function inspect(session: AgentSession, id: string) {
  assert('invokeTool' in session && typeof session.invokeTool === 'function');
  return session.invokeTool('inspect_acceptance', {}, id) as Promise<RuntimeAcceptanceState>;
}

/** A real session-wide lease, distinct from revoking an individual inspection/operation port. */
export async function verifyNativeLifetime(
  services: Services,
  directory: string,
  owner: RuntimeProcessIdentity,
) {
  const target = await catPilotVerificationTarget(
    services,
    owner,
    'native-lifetime',
    'native-lifetime-no-active-run',
  );
  const before = JSON.stringify(target.task);
  const reviewKey = c4ReviewKey(target.context.id, target.task.id);
  const review = structuredClone(services.db.getSetting(reviewKey, null));
  const config = nativeProbeConfig(directory, target.context.root, 'native-lifetime', true);
  config.tools!.verificationScope = target.verification.scope;
  const { owners, records, options } = nativeProbeOptions(directory, target.context.root, true);
  const entries = resolve('apps/desktop/out/main');
  let lease = new AbortController();
  let revokeAtAdmission = true;
  const recordOwner = options.processStarted!;
  options.processStarted = (pid, identity) => {
    recordOwner(pid, identity);
    if (revokeAtAdmission) lease.abort();
  };
  let started: (() => void) | undefined;
  const host = () => ({
    signal: lease.signal,
    verification: {
      ...target.verification,
      acceptance: {
        inspect(admission: typeof target.verification.admission, signal: AbortSignal) {
          const entered = started;
          started = undefined;
          entered?.();
          return target.verification.acceptance.inspect(admission, signal);
        },
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
      host(),
      entries,
    );
    const actual = session;
    drain = (async () => {
      for await (const _event of actual.events) {
        /* Drain actual native events. */
      }
    })();
  };
  const closed = async () => {
    await operationTimeout(session!.close(), 45_000, 'Native lease shutdown was not confirmed');
    await drain;
    for (const owner of owners) assert.equal(await processBirth(owner.pid), undefined);
  };
  try {
    await assert.rejects(start());
    assert.equal(owners.length, 1);
    assert.equal(await processBirth(owners[0]!.pid), undefined);
    assert(!existsSync(config.journalPath), 'Startup cancellation admitted a late journal');
    revokeAtAdmission = false;
    lease = new AbortController();
    await start();
    const state = await inspect(session!, 'initial');
    assert.equal(state.criteria.length, 9);
    assert.equal(state.binding?.execution, 'blocked');
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = inspect(session!, 'in-flight');
    void pending.catch(() => undefined);
    await operationTimeout(entered, 20_000, 'Actual lease inspection did not start');
    lease.abort();
    await assert.rejects(pending);
    // Automatic cleanup must end the iterator, before the driver calls close itself.
    await operationTimeout(drain!, 45_000, 'Revoked session did not end automatically');
    await closed();
    const retired = session!;
    const count = records.size;
    await assert.rejects(inspect(retired, 'late'), /admission is closed/);
    await assert.rejects(
      retired.send({ text: 'This revoked instance must never resume' }),
      /admission is closed/,
    );
    assert.equal(records.size, count);
    const cancelled = [...records.values()].find((record) => record.id === 'cmd:in-flight');
    assert(cancelled?.result.error, 'Cancelled inspection lacks a durable outcome');
    await assert.rejects(
      startBuiltinNativeSession(
        config,
        join(directory, 'native-attachments'),
        options,
        host(),
        entries,
      ),
    );
    assert.equal(owners.length, 2);

    lease = new AbortController();
    await start();
    await assert.rejects(
      session!.send({ text: 'Resume with a fresh native host lease only' }),
      /no model request was sent/,
    );
    assert.deepEqual((await inspect(session!, 'fresh-host')).criteria, state.criteria);
    await assert.rejects(inspect(retired, 'old-instance'), /admission is closed/);
    lease.abort();
    await operationTimeout(drain!, 45_000, 'Fresh revoked session did not end automatically');
    await closed();
    assert.equal(owners.length, 3);
    assert.equal(JSON.stringify(await target.context.store.readTask(target.task.id)), before);
    assert.deepEqual(services.db.getSetting(reviewKey, null), review);
    assert(
      ![...records.values()]
        .flatMap((record) => record.facts)
        .some((fact) => fact.type === 'process'),
    );
    return {
      project: 'Cat-pilot',
      taskId: target.task.id,
      criteria: state.criteria.length,
      cancellationAtOwnership: true,
      noLateStartupJournal: true,
      inFlightRevocation: true,
      automaticShutdown: true,
      lateCallsRejectedBeforeDispatch: true,
      abortedLeaseCannotStart: true,
      freshLeaseRestart: true,
      retiredInstanceRejected: true,
      durableCancelledResult: true,
      nativeProcesses: owners.length,
      exitsConfirmed: true,
      taskAndC4Unchanged: true,
      checkProcesses: 0,
      modelRequests: 0,
      journal: config.journalPath,
    };
  } finally {
    await session?.close();
    await drain;
  }
}
