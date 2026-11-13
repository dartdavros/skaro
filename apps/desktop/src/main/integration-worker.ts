import { randomUUID } from 'node:crypto';
import type { AgentSession } from '@skaro/timeline';
import { questionMessageNote, runEvent, withSkaroNote } from '@skaro/timeline';
import { hasOwnerCommand } from './owner-command-history';
import type { TaskRunEngine } from './task-run-engine';
import { integrationInstructions } from './integration-prompt';
import { integrationEnvironmentKey, type IntegrationOperation } from './integration-model';
import type { IntegrationHistory } from './integration-history';
import { taskBrowserServer } from './task-browser';
import { IntegrationAgentUnavailable } from './integration-failure';
import { UnstartedInputs } from './integration-unstarted-inputs';
import { resourceSessionAdmission } from './resource-session';

export interface ResolverSession {
  session: AgentSession;
  worker: string;
  operation: IntegrationOperation;
}

/** A resolver owns only its candidate, uses the configured adapter and occupies a normal queue slot. */
export async function runIntegrationWorker(
  ctx: TaskRunEngine,
  op: IntegrationOperation,
  history: IntegrationHistory,
  publishSession: (value: ResolverSession | undefined) => void,
): Promise<void> {
  const context = ctx.project(op.projectId);
  const artifacts = await context.load();
  const task = artifacts.tasks.find((task) => task.id === op.taskId);
  if (!task || task.archived || task.status === 'cancelled')
    throw new Error('Integration owner task is no longer active.');
  const settings = await ctx.views.withDefaults(
    ctx.views.settings(op.projectId, task, artifacts).agent,
    context.root,
    ctx.views.settings(op.projectId, task, artifacts),
  );
  await ctx.views.ensureAgent(settings.agent);
  ctx.integrations.assertExecuting(op);
  const worker = `integration-${op.id}-${randomUUID()}`;
  op.worker = worker;
  op.attempts++;
  ctx.integrations.service.save(op);
  let grant: ReturnType<typeof ctx.deps.mcp.grant> | undefined;
  let session: AgentSession | undefined;
  let pump: Promise<void> | undefined;
  let finish: (error?: Error) => void = () => undefined;
  const unstarted = new UnstartedInputs();
  // Long verification plans and user approvals may outlive any one check.
  // The adapter's terminal event or process exit ends this worker, not elapsed time.
  const ended = new Promise<void>((resolve, reject) => {
    finish = (error) => (error ? reject(error) : resolve());
  });
  void ended.catch(() => undefined);
  try {
    const environmentKey = integrationEnvironmentKey(op);
    ctx.environments.bindIntegration(environmentKey, op.worktree);
    const environment = await ctx.environments.describe(environmentKey);
    ctx.integrations.assertExecuting(op);
    ctx.deps.db.setSetting(`integration.${op.id}.env`, environment.variables);
    grant = ctx.deps.mcp.grant({
      kind: 'integration',
      projectId: op.projectId,
      taskId: op.taskId,
      integrationId: op.id,
      runId: worker,
    });
    const sandbox =
      settings.permissionMode === 'auto'
        ? await ctx.deps.agents.sandbox(settings.agent)
        : undefined;
    ctx.integrations.assertExecuting(op);
    session = await ctx.deps.agents.adapter(settings.agent).start({
      resourceAdmission: resourceSessionAdmission(
        ctx.deps.db,
        op.projectId,
        `integration:${op.id}`,
        `managed:${settings.agent}`,
        () => ctx.integrations.assertExecuting(op),
        op.worktree,
        worker,
      ),
      cwd: op.worktree,
      model: settings.model,
      effort: settings.effort,
      permissionMode: settings.permissionMode,
      planFirst: false,
      instructions: integrationInstructions(op, context.root, artifacts),
      env: environment.variables,
      resume: op.nativeAgent === settings.agent ? op.nativeSessionId : undefined,
      processStarted: (pid, identity) => {
        ctx.processes.started(worker, pid, false, identity);
        ctx.integrations.assertExecuting(op);
      },
      sandboxVerified: sandbox?.holds,
      sandboxMode: sandbox?.mode,
      mcpServers: {
        skaro: {
          type: 'http',
          url: grant.url,
          headers: grant.headers,
          trusted: true,
          timeout: 30 * 60_000,
        },
        playwright: await taskBrowserServer(ctx.deps.dataDir, worker),
      },
      raw: (line) => history.raw(op, line),
      rawSerialized: (line) => history.raw(op, line),
      secretValues: () => history.secrets(op).list(),
      context: ctx.deps.attachments.context(),
    });
    publishSession({ session, worker, operation: op });
    ctx.integrations.assertExecuting(op);
    const pending = ctx.integrations.store.inputs(op.id);
    const timeline = (await history.state(op)).state;
    const inputs = pending
      .filter((input) => !hasOwnerCommand(timeline, input.commandId))
      .map((input) => history.secrets(op).input(input));
    const automatic = inputs.length === 0;
    const text = automatic
      ? 'Continue the saved integration.'
      : withSkaroNote(
          inputs
            .flatMap((input) => [
              input.commandId ? `command_id: ${input.commandId}` : '',
              questionMessageNote(timeline, input.internal),
            ])
            .filter(Boolean)
            .join('\n'),
          inputs.map((input) => input.text).join('\n'),
        );
    pump = (async () => {
      try {
        for await (const event of session!.events) {
          if (op.worker !== worker) break;
          unstarted.observe(event);
          // Internal orchestration is kept in raw IO, never presented as a human message.
          if (
            automatic &&
            event.t === 'item.upsert' &&
            event.item.kind === 'message' &&
            event.item.role === 'user' &&
            event.item.text.trim() === text
          )
            continue;
          if (event.t === 'session.started') {
            op.nativeSessionId = event.nativeSessionId;
            op.nativeAgent = settings.agent;
            op.nativeEffort = settings.effort;
            ctx.integrations.service.save(op);
          }
          history.enqueue(op, runEvent(event, worker));
          if (event.t === 'interaction.opened') ctx.integrations.setRuntime(op, 'waiting');
          if (event.t === 'turn.completed' && !event.continuing) {
            await history.drain(op);
            // The turn ended before the agent took Skaro's message; the turn answering it follows.
            if (event.outcome === 'done' && unstarted.waiting) continue;
            if ((await history.state(op)).state.interactions.some((i) => i.kind === 'question')) {
              op.state = 'waiting';
              ctx.integrations.service.save(op);
              finish();
              continue;
            }
            if (event.outcome === 'interrupted') {
              op.state = 'paused';
              ctx.integrations.service.save(op);
            }
            const failure = event.error?.message ?? 'Integration agent failed';
            finish(
              event.outcome !== 'failed'
                ? undefined
                : event.error?.category === 'auth' || event.error?.category === 'limit'
                  ? new IntegrationAgentUnavailable(failure)
                  : new Error(failure),
            );
          }
        }
        finish(new Error('Integration agent exited before completing its turn.'));
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    })();
    await session.send({
      text,
      images: inputs.flatMap((input) => input.images ?? []),
    });
    ctx.integrations.store.delivered(op.id, pending.length);
    await ended;
    if (op.state !== 'ready' && op.state !== 'paused') {
      // The agent ended its turn on a question or a report: repeating the turn changes nothing,
      // so the candidate waits for the owner's message.
      op.state = 'waiting';
      ctx.integrations.service.save(op);
    }
    await session.close();
    await pump;
  } finally {
    grant?.revoke();
    publishSession(undefined);
    await ctx.processes.stop(worker);
    await session?.close().catch(() => undefined);
    await pump;
    await history.settleBackground(op);
    await history.close(op);
    op.worker = undefined;
    ctx.integrations.service.save(op);
  }
}
