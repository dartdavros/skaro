import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ProjectArtifacts } from '@skaro/core';
import type {
  BuiltinSessionStart,
  RuntimeVerificationHost,
  SessionOptions,
  SkaroScope,
} from '@skaro/timeline';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import type { NativeAdmissions } from './native/admissions';
import type { NativeSessionHost } from './native/host-binding';
import { startBuiltinNativeSession } from './native/bundled';
import {
  builtinTaskAdmission,
  confirmBuiltinTaskExit,
  revokeBuiltinTaskAdmission,
  requireCurrentBuiltinTask,
} from './builtin-task-admission';
import { requireBuiltinTaskSessionPolicy } from './builtin-task-session-policy';
import { settingsKey } from './task-run-helpers';
import { taskSessionOptions, type TaskSessionSettings } from './task-session-options';
import { builtinAcceptancePort } from './builtin-acceptance';

/** Main-only composition port. A saved route alone cannot prepare a task's model/payload/budget grants. */
export interface BuiltinTaskSessionPreparer {
  prepare(input: {
    scope: SkaroScope;
    sessionId: string;
    journalPath: string;
    artifactDir: string;
    options: SessionOptions;
    admissions: NativeAdmissions;
    verification: RuntimeVerificationHost;
    signal: AbortSignal;
  }): Promise<{
    config: BuiltinSessionStart;
    host: NativeSessionHost & { model: NonNullable<NativeSessionHost['model']> };
    close(): void;
  }>;
}

/** Attaches only an existing real task run. Queue, execution intent and completion remain with it. */
export async function startBuiltinTaskSession(
  ctx: TaskRunEngine,
  active: ActiveRun,
  artifacts: ProjectArtifacts,
) {
  const prepare = ctx.deps.builtinSessions;
  if (!prepare) throw new Error('Builtin task model/payload/budget admission is not configured');
  const { projectId, taskId, run } = active;
  const resume = run.nativeSessionId;
  const sessionId = resume ?? randomUUID();
  const directory = join(ctx.deps.dataDir, 'builtin', 'tasks', run.id);
  const scope: SkaroScope = { kind: 'task', projectId, taskId, runId: run.id };
  const startup = new AbortController();
  active.builtinStartup = startup;
  let lease: NativeAdmissions | undefined;
  let prepared: Awaited<ReturnType<BuiltinTaskSessionPreparer['prepare']>> | undefined;
  let session: Awaited<ReturnType<typeof startBuiltinNativeSession>> | undefined;
  try {
    lease = await builtinTaskAdmission(ctx, scope, sessionId, startup.signal);
    const signal = AbortSignal.any([startup.signal, lease.signal]);
    await ctx.processes.stop(run.id);
    const saved = ctx.deps.db.getSetting<Partial<TaskSessionSettings> | null>(
      settingsKey(projectId, taskId),
      null,
    );
    const settings: TaskSessionSettings = {
      ...saved,
      ...(saved?.model || run.model ? { model: saved?.model ?? run.model } : {}),
      permissionMode: saved?.permissionMode ?? artifacts.config.permissionMode,
      planFirst: saved?.planFirst ?? false,
    };
    const segment = active.segments++;
    const options = await taskSessionOptions(ctx, active, artifacts, settings, segment);
    requireCurrentBuiltinTask(ctx, scope, sessionId, active, signal);
    const expected = {
      scope,
      sessionId,
      journalPath: join(directory, 'journal.jsonl'),
      artifactDir: join(directory, 'artifacts'),
      options,
    };
    prepared = await prepare.prepare({
      ...expected,
      scope: structuredClone(scope),
      options: { ...options, ...(options.readDirs ? { readDirs: [...options.readDirs] } : {}) },
      admissions: lease,
      signal,
      verification: {
        scope,
        admission: lease.admission,
        signal,
        acceptance: builtinAcceptancePort(ctx, scope, lease),
      },
    });
    requireBuiltinTaskSessionPolicy(expected, prepared.config);
    requireCurrentBuiltinTask(ctx, scope, sessionId, active, signal);
    active.builtinClose = () => prepared!.close();
    // Persist before spawn: recovery must find the same journal even if main exits before its first event.
    ctx.deps.db.setRunSession(run.id, sessionId);
    active.run = { ...active.run, nativeSessionId: sessionId };
    ctx.history.writeLine(active, {
      ts: Date.now() - run.startedAt,
      dir: 'meta',
      line: { skaro: 'segment', agent: run.agent, adapterVersion: run.adapterVersion },
    });
    const host = prepared.host;
    const boundSignal = AbortSignal.any([signal, ...(host.signal ? [host.signal] : [])]);
    const admitted = lease;
    session = await startBuiltinNativeSession(
      prepared.config,
      ctx.deps.attachments.dir,
      {
        ...options,
        signal: boundSignal,
        processStarted(pid, identity) {
          if (!identity) throw new Error('Builtin task process has no OS identity');
          options.processStarted!(pid, identity);
          admitted.recordOwnership({ pid, ...identity });
        },
      },
      { ...host, signal: boundSignal },
    );
    await lease.requireActive(lease.admission, boundSignal);
    return { session, segment, resume };
  } catch (error) {
    if (lease) {
      try {
        if (!active.builtinClose) prepared?.close();
      } finally {
        const owned = await revokeBuiltinTaskAdmission(active, 'Builtin task startup failed');
        try {
          await session?.close();
        } finally {
          await ctx.processes.stop(run.id);
          await confirmBuiltinTaskExit(active, owned);
        }
      }
    }
    throw error;
  } finally {
    if (active.builtinStartup === startup) active.builtinStartup = undefined;
  }
}
