import { isRunLogMeta, segmentTurns, runEvent, type AgentSession } from '@skaro/timeline';
import type { AgentId } from '../shared/ipc';
import { taskInstructions } from './prompt';
import { acceptanceInstructions } from './prompt-acceptance';
import { subjectStage } from './task-subject';
import { taskBrowserServer } from './task-browser';
import { errorText } from './session-log';
import { key, settingsKey, findTask } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import { checkoutKey, ownsCheckout, stageIdOf } from './task-stage';
import type { TaskRunEngine } from './task-run-engine';
import { handoffRecord } from './task-handoff-record';
import { taskRunDirectory } from './task-run-directory';
import { closeSessionLog } from './close-session-log';

const ENVIRONMENT_TOOL_TIMEOUT_MS = 30 * 60_000;

/** sessions: a focused part of the task-run controller. */
export class TaskRunSessions {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  attach(active: ActiveRun): Promise<AgentSession> {
    if (active.switching) return Promise.reject(new Error('The agent is being changed.'));
    if (this.ctx.deps.db.getRun(active.run.id)?.retiredAt !== undefined)
      return Promise.reject(
        new Error('The run belongs to a deleted task. Start the current task in a new session.'),
      );
    taskRunDirectory(this.ctx.project(active.projectId).root, active.run);
    if (active.session) return Promise.resolve(active.session);
    active.attaching ??= this.startSession(active).finally(() => (active.attaching = undefined));
    return active.attaching;
  }

  async startSession(active: ActiveRun): Promise<AgentSession> {
    const { projectId, taskId, run } = active;
    const context = this.ctx.project(projectId);
    const artifacts = await context.load();
    if (!artifacts.tasks.some((task) => task.id === taskId))
      throw new Error('Milestones have no agent sessions. Use a task or the project chat.');
    const task = findTask(artifacts, taskId);
    const cwd = taskRunDirectory(context.root, run);
    const agent = run.agent as AgentId;
    await this.ctx.views.ensureAgent(agent);
    await this.ctx.processes.stop(run.id);
    const settings = await this.ctx.views.withDefaults(
      agent,
      context.root,
      this.ctx.views.settings(projectId, task, artifacts),
    );
    // A started session keeps the exact resolved model/effort when project defaults change.
    this.ctx.deps.db.setSetting(settingsKey(projectId, taskId), settings);
    const sandbox =
      settings.permissionMode === 'auto' ? await this.ctx.deps.agents.sandbox(agent) : undefined;
    const resume = run.nativeSessionId;
    const handoff = handoffRecord(run);
    const inWorktree = run.worktree !== undefined;

    const segment = active.segments++;
    this.ctx.history.writeLine(active, {
      ts: Date.now() - run.startedAt,
      dir: 'meta',
      line: { skaro: 'segment', agent, adapterVersion: run.adapterVersion },
    });
    // A task in its own checkout gets the name and ports of its environment in its shell.
    const environment = inWorktree
      ? await this.ctx.environments.describe(checkoutKey(active)).catch(() => undefined)
      : undefined;
    // A run named after a milestone is the acceptance of its stage.
    const acceptance = subjectStage(artifacts, taskId);
    const stageId = stageIdOf(run);
    const stage = stageId ? artifacts.milestones.find((m) => m.id === stageId) : undefined;
    active.grant = this.ctx.deps.mcp.grant({ kind: 'task', projectId, taskId, runId: run.id });
    let session: AgentSession;
    try {
      session = await this.ctx.deps.agents.adapter(agent).start({
        cwd,
        processStarted: (pid, identity) => this.ctx.processes.started(run.id, pid, false, identity),
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.effort ? { effort: settings.effort } : {}),
        permissionMode: settings.permissionMode,
        planFirst: settings.planFirst,
        instructions:
          (acceptance
            ? acceptanceInstructions({
                stage: acceptance,
                artifacts,
                root: context.root,
                cwd,
                branch: run.branch ?? '',
                locale: this.ctx.deps.locale(),
                managedEnvironment: environment?.config !== undefined,
              })
            : taskInstructions({
                task,
                artifacts,
                root: context.root,
                cwd,
                ...(inWorktree && run.branch ? { branch: run.branch } : {}),
                ...(inWorktree && stage ? { stage } : {}),
                locale: this.ctx.deps.locale(),
                managedEnvironment: environment?.config !== undefined,
              })) +
          (handoff
            ? `\n\n${handoff.context}\n\nUser messages queued before handoff: ${JSON.stringify(handoff.inputs)}`
            : ''),
        ...(environment ? { env: environment.variables } : {}),
        mcpServers: {
          playwright: await taskBrowserServer(this.ctx.deps.dataDir, run.id),
          skaro: {
            type: 'http',
            url: active.grant.url,
            headers: active.grant.headers,
            trusted: true,
            // start_environment builds images and copies data: minutes on the first call.
            timeout: ENVIRONMENT_TOOL_TIMEOUT_MS,
          },
        },
        ...(sandbox ? { sandboxVerified: sandbox.holds } : {}),
        ...(sandbox?.mode ? { sandboxMode: sandbox.mode } : {}),
        ...(resume ? { resume } : {}),
        rawSerialized: (line) => this.ctx.history.writeLine(active, line),
        rawScope: {
          startedAt: run.startedAt,
          segment,
          ...(run.previousRunId ? { runId: run.id } : {}),
        },
        secretValues: () => active.secrets.list(),
        raw: (line) => {
          let meta = line.line;
          if (line.dir === 'meta' && isRunLogMeta(meta) && meta.skaro === 'event') {
            const event = segmentTurns(segment, meta.event);
            meta = { ...meta, event: run.previousRunId ? runEvent(event, run.id) : event };
          }
          this.ctx.history.writeLine(active, {
            ...line,
            line: meta,
            ts: Date.now() - run.startedAt,
          });
        },
        context: this.ctx.deps.attachments.context(),
      });
    } catch (error) {
      active.grant.revoke();
      active.grant = undefined;
      if (resume) this.ctx.history.notice(active, 'session_lost', 'error', errorText(error));
      throw error;
    }
    active.session = session;
    if (resume) this.ctx.history.notice(active, 'session_restored', 'info', '');
    active.pumping = this.pump(active, session, segment);
    this.ctx.changed(projectId, taskId);
    return session;
  }

  async pump(active: ActiveRun, session: AgentSession, segment: number): Promise<void> {
    try {
      for await (const event of session.events) {
        const scoped = segmentTurns(segment, event);
        this.ctx.events.onEvent(
          active,
          active.run.previousRunId ? runEvent(scoped, active.run.id) : scoped,
        );
      }
    } catch (error) {
      this.ctx.events.failTurn(active, error);
    }
    if (active.session === session && !active.switching) {
      active.session = undefined;
      active.grant?.revoke();
      active.grant = undefined;
      // A turn still open when the process went away ends here (agent-output.md 6).
      const turn = active.timeline.state.turns.at(-1);
      if (turn && !turn.outcome)
        this.ctx.events.failTurn(active, new Error('The agent process exited'));
      this.ctx.changed(active.projectId, active.taskId);
    }
  }

  async detach(active: ActiveRun): Promise<void> {
    // An attachment already in flight must not publish a new process after cleanup has run.
    await active.attaching?.catch(() => undefined);
    const session = active.session;
    active.session = undefined;
    active.grant?.revoke();
    active.grant = undefined;
    await this.ctx.processes.stop(active.run.id);
    await session?.close().catch(() => undefined);
    this.ctx.history.flush(active);
    // A closed session ends no turn by itself: its slot must not stay taken.
    active.release?.();
    active.release = undefined;
  }

  /** A handoff must prove shutdown; a timeout/error leaves the old run frozen for retry. */
  async stopForHandoff(active: ActiveRun): Promise<void> {
    active.grant?.revoke();
    active.grant = undefined;
    const session = active.session;
    if (session) {
      for (const item of active.timeline.state.items)
        if (item.kind === 'command' && item.background?.state === 'running')
          await session.stopBackground(item.background.taskId);
      await this.ctx.processes.stop(active.run.id);
      await session.close();
      await active.pumping;
      active.session = undefined;
    } else await this.ctx.processes.stop(active.run.id);
  }

  async close(): Promise<void> {
    this.ctx.closing = true;
    // Releasing a review slot during shutdown must not launch a queued agent turn.
    for (const queued of this.ctx.queue.state().queued) this.ctx.queue.cancel(queued);
    await this.ctx.reviews.close();
    await this.ctx.integrations.close();
    await this.ctx.merges.close();
    await Promise.all([...this.ctx.active.values()].map((a) => this.detach(a)));
    await Promise.all([...this.ctx.active.values()].map((active) => closeSessionLog(active.log)));
    await this.ctx.environments
      .close()
      .catch((error) => console.error('Environment shutdown:', error));
    await this.ctx.environments.idle();
  }

  async forget(projectId: string, taskId: string): Promise<void> {
    const k = key(projectId, taskId);
    if (
      this.ctx.integrations.store
        .all(projectId)
        .some(
          (op) =>
            (op.taskId === taskId || op.results.some((result) => result.taskId === taskId)) &&
            (op.worker || op.executor),
        )
    )
      throw new Error('Stop the task integration before deleting its checkout.');
    const git = this.ctx.project(projectId).git;
    const runs = this.ctx.deps.db.listRuns(projectId, taskId);
    // The checkout, the branch and the environment of a stage belong to its other tasks too:
    // deleting one task leaves them alone.
    const own = runs.filter(ownsCheckout);
    const worktrees = new Set(own.flatMap((run) => (run.worktree ? [run.worktree] : [])));
    const branches = new Set(own.flatMap((run) => (run.branch ? [run.branch] : [])));
    const active = this.ctx.active.get(k);
    if (active?.switching) throw new Error('The agent is being changed; retry after the handoff.');
    this.ctx.queue.cancel(k);
    this.ctx.queuedInputs.delete(k);
    await this.ctx.reviews.stop(projectId, taskId);
    // No writer may recreate services or keep using them while deletion removes the environment.
    if (active) await this.detach(active);
    else for (const run of runs) await this.ctx.processes.stop(run.id);
    // Containers retain checkout mounts even while stopped, so release them before Git's check.
    if (own.length === runs.length) await this.ctx.removeEnvironment({ projectId, taskId });
    // A failed preflight keeps the task, history and checkout available for recovery.
    for (const worktree of worktrees) await git.assertRemovableWorktree(worktree);
    if (active) {
      active.log?.end();
      this.ctx.active.delete(k);
    }
    for (const run of runs) {
      if (!run.endedAt) this.ctx.deps.db.finishRun(run.id, 'interrupted');
    }
    for (const worktree of worktrees) await git.removeWorktree(worktree);
    for (const branch of branches) await git.deleteBranch(branch);
    this.ctx.deps.db.setSetting(settingsKey(projectId, taskId), null);
    this.ctx.setRuntime(projectId, taskId, 'idle');
    await this.ctx.stages.sync(projectId, taskId);
  }
}
