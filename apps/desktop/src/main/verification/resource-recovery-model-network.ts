import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { appendFile, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { c4Hash } from '@skaro/core';
import { randomUUID } from 'node:crypto';
import type { AgentSession } from '@skaro/timeline';
import type { Services } from '../app-services';
import { resourceSessionAdmission } from '../resource-session';
import { cleanCompletedWorktrees } from '../task-worktree-retention';
import type { RecoveryCase } from './resource-recovery-case';
import { recoveryProcessMeasurements } from './resource-recovery-processes';

async function requireClosedProxy() {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: 1 });
    socket.setTimeout(2000, () => {
      socket.destroy();
      reject(new Error('Proxy port state unknown'));
    });
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error('Refuse an occupied local proxy port'));
    });
    socket.once('error', (error: NodeJS.ErrnoException) =>
      error.code === 'ECONNREFUSED' ? resolve() : reject(error),
    );
  });
}
/** Same real configured Codex/account/model; only this client's proxy connection is unavailable. */
export async function recoveryModelNetwork(s: Services, scenario: RecoveryCase, directory: string) {
  await requireClosedProxy();
  const ctx = s.runs['engine'],
    artifacts = await s.projects.get(scenario.project).load();
  const task = artifacts.tasks.find((t) => t.id === 'T-013')!;
  const settings = await ctx.views.withDefaults(
    'codex',
    scenario.root,
    ctx.views.settings(scenario.project, task, artifacts),
  );
  await s.agents.requireReady('codex');
  const owner = `${scenario.pin}:model-network`,
    key = `${owner}:process`,
    abort = new AbortController();
  const log = join(directory, `native-model-transport-${randomUUID()}.jsonl`);
  let activeProcesses: Awaited<ReturnType<typeof recoveryProcessMeasurements>> | undefined;
  let writes = Promise.resolve(),
    session: AgentSession | undefined,
    failure = '',
    native = '',
    successful = false;
  const raw = (value: unknown) => {
    writes = writes.then(() =>
      appendFile(log, value instanceof Uint8Array ? value : JSON.stringify(value) + '\n'),
    );
    void writes.catch(() => undefined);
  };
  const timer = setTimeout(
    () => abort.abort(new Error('Native transport failure was not observed within 90s')),
    90_000,
  );
  const stopOnAbort = () => {
    void ctx.processes.stop(key).catch(() => undefined);
  };
  abort.signal.addEventListener('abort', stopOnAbort, { once: true });
  const started = performance.now();
  try {
    session = await s.agents.adapter('codex').start({
      cwd: scenario.root,
      model: settings.model,
      effort: settings.effort,
      permissionMode: 'ask',
      readOnly: true,
      planFirst: false,
      mcpServers: {},
      signal: abort.signal,
      instructions:
        'Read-only transport acceptance probe. Do not call tools or change files. Reply RC4 only.',
      env: {
        HTTP_PROXY: 'http://127.0.0.1:1',
        HTTPS_PROXY: 'http://127.0.0.1:1',
        ALL_PROXY: 'http://127.0.0.1:1',
        NO_PROXY: '',
      },
      processStarted: (pid, identity) => ctx.processes.started(key, pid, false, identity),
      resourceAdmission: resourceSessionAdmission(
        s.db,
        scenario.project,
        owner,
        'managed:codex',
        () => abort.signal.throwIfAborted(),
        scenario.root,
        key,
      ),
      context: s.attachments.context(),
      raw,
      rawSerialized: raw,
    });
    const pump = (async () => {
      for await (const event of session!.events) {
        if (event.t === 'session.started') native = event.nativeSessionId;
        if (event.t === 'interaction.opened')
          throw new Error('Unexpected interaction in transport probe');
        if (
          event.t === 'item.upsert' &&
          event.item.kind === 'notice' &&
          event.item.code === 'retry' &&
          /network|transport|connect|proxy|request|stream|sending/i.test(event.item.text)
        ) {
          failure = event.item.text;
          return;
        }
        if (event.t === 'turn.completed' && !event.continuing) {
          successful = event.outcome === 'done';
          failure = event.error?.message ?? '';
          return;
        }
      }
      throw new Error('Native probe ended without a terminal outcome');
    })();
    void pump.catch(() => undefined);
    await session.send({ text: 'Read-only transport probe. Do not use tools. Reply RC4.' });
    activeProcesses = await recoveryProcessMeasurements();
    await pump;
    assert(
      !successful,
      'Connection loss was not reproduced; never claim a successful response as failure',
    );
    assert.match(failure, /network|transport|connect|retry|proxy|request|stream|sending/i);
    await cleanCompletedWorktrees(ctx);
  } finally {
    clearTimeout(timer);
    abort.signal.removeEventListener('abort', stopOnAbort);
    abort.abort(new Error('Transport verification finished'));
    await ctx.processes.stop(key);
    await session?.close();
    await writes;
    const handle = await open(log, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    s.resources.reconcileProcess(scenario.project, key);
  }
  assert(!s.resources.holdings(scenario.project, owner).length);
  return {
    nativeSession: native,
    activeProcesses,
    model: settings.model,
    account: 'managed:codex',
    failureHash: c4Hash(failure),
    log,
    logHash: c4Hash(await readFile(log, 'utf8')),
    actualNativeTransportFailure: true,
    boundary:
      'Actual native transport retry notice, then verified owner stop; no terminal provider outcome claimed',
    successfulModelResponses: 0,
    elapsedMs: performance.now() - started,
    sameAccountAndModel: true,
    proxyScopedToOneChild: true,
    noServerCreated: true,
    housekeepingWhileModelUnavailable: true,
  };
}
