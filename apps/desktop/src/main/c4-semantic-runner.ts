import { mkdir, appendFile, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { c4Hash } from '@skaro/core';
import type { AgentSession } from '@skaro/timeline';
import type { TaskRunEngine } from './task-run-engine';
import type { C4SemanticJob } from './c4-semantic-store';
import { c4ReviewAdmission } from './c4-review-admission';
import { c4SemanticSources } from './c4-semantic-sources';
import { c4SemanticPrompt } from './c4-semantic-prompt';
import type { c4SemanticSnapshot } from './c4-semantic-snapshot';
import { parseC4SemanticVerdict } from './c4-semantic-result';

/** Normal configured native adapter, separate read-only session and real model/process admission. */
export async function runSemanticC4Review(
  ctx: TaskRunEngine,
  job: C4SemanticJob,
  snapshot: Awaited<ReturnType<typeof c4SemanticSnapshot>>,
  signal: AbortSignal,
  requireCurrent: () => Promise<void>,
  packageText?: string,
) {
  const context = ctx.project(job.projectId),
    artifacts = await context.load();
  const task = artifacts.tasks.find((t) => t.id === job.taskId);
  if (!task) throw new Error('C4 review task disappeared');
  const settings = await ctx.views.withDefaults(
    ctx.views.settings(job.projectId, task, artifacts).agent,
    context.root,
    ctx.views.settings(job.projectId, task, artifacts),
  );
  await ctx.views.ensureAgent(settings.agent);
  if (ctx.deps.db.getRun(job.runId)?.agent !== settings.agent)
    throw new Error('C4 reviewer account changed; use the current task handoff');
  await requireCurrent();
  const worker = job.worker ?? `c4-review-${job.id}-${randomUUID()}`;
  const log = join(ctx.deps.dataDir, 'c4', 'semantic-reviews', job.projectId, `${worker}.jsonl`);
  await mkdir(join(ctx.deps.dataDir, 'c4', 'semantic-reviews', job.projectId), { recursive: true });
  let session: AgentSession | undefined,
    nativeSessionId = '',
    completed = false,
    text = '';
  let writes = Promise.resolve();
  const raw = (line: unknown) => {
    writes = writes.then(() =>
      appendFile(log, line instanceof Uint8Array ? line : JSON.stringify(line) + '\n'),
    );
    void writes.catch(() => undefined);
  };
  const aborted = () => {
    void ctx.processes.stop(worker).catch(() => undefined);
  };
  const permit = await c4ReviewAdmission(ctx.deps.db, ctx.deps.dataDir, job, requireCurrent);
  signal.addEventListener('abort', aborted, { once: true });
  let verdict: ReturnType<typeof parseC4SemanticVerdict> | undefined, logHash: string;
  try {
    await requireCurrent();
    session = await ctx.deps.agents.adapter(settings.agent).start({
      cwd: snapshot.observation.impact.checkout,
      model: settings.model,
      effort: settings.effort,
      ...(settings.budgetUsd !== undefined ? { budgetUsd: settings.budgetUsd } : {}),
      permissionMode: 'ask',
      readOnly: true,
      planFirst: false,
      signal,
      resourceAdmission: permit.admission,
      instructions:
        'Independent read-only architecture verifier. Never implement task work. Return the exact requested JSON only.',
      processStarted: (pid, identity) => ctx.processes.started(worker, pid, false, identity),
      mcpServers: {},
      raw,
      rawSerialized: raw,
      secretValues: () => [],
      context: ctx.deps.attachments.context(),
    });
    const pump = (async () => {
      for await (const event of session!.events) {
        signal.throwIfAborted();
        if (event.t === 'session.started') nativeSessionId = event.nativeSessionId;
        if (event.t === 'interaction.opened')
          throw new Error(
            'Independent C4 verifier requested an interaction; evidence remains unverified',
          );
        if (
          event.t === 'item.upsert' &&
          event.item.kind === 'message' &&
          event.item.role === 'agent' &&
          event.item.phase !== 'commentary'
        )
          text = event.item.text;
        if (event.t === 'turn.completed' && !event.continuing) {
          if (event.outcome !== 'done')
            throw new Error(event.error?.message ?? 'Independent C4 review failed');
          completed = true;
          return;
        }
      }
      throw new Error('Independent C4 review ended without a completed turn');
    })();
    void pump.catch(() => undefined);
    const sources = await c4SemanticSources(snapshot.observation);
    await session.send({ text: c4SemanticPrompt(snapshot, packageText, sources) });
    await pump;
    await requireCurrent();
    if (!completed || !nativeSessionId)
      throw new Error('Independent C4 reviewer has no confirmed result');
    verdict = parseC4SemanticVerdict(text, job.fingerprint, snapshot.observation);
  } finally {
    signal.removeEventListener('abort', aborted);
    await ctx.processes.stop(worker);
    await session?.close();
    try {
      await writes;
      const handle = await open(log, 'r+');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      logHash = c4Hash(await readFile(log, 'utf8'));
    } finally {
      permit.release();
    }
  }
  return {
    verdict: verdict!,
    reviewer: { worker, nativeSessionId, agent: settings.agent, log, logHash },
  };
}
