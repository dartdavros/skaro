import { segmentTurns, runEvent, type AgentSession } from '@skaro/timeline';
import type { AgentId } from '../shared/ipc';
import { errorText } from './session-log';
import { key, settingsKey, findTask } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import { ownsCheckout } from './task-stage';
import type { TaskRunEngine } from './task-run-engine';
import { taskRunDirectory } from './task-run-directory';
import { closeSessionLog } from './close-session-log';
import { taskSessionOptions } from './task-session-options';
import { startBuiltinTaskSession } from './builtin-task-session';
import { revokeBuiltinTaskAdmission, confirmBuiltinTaskExit } from './builtin-task-admission';

/** sessions: a focused part of the task-run controller. */
export class TaskRunSessions {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  attach(active: ActiveRun): Promise<AgentSession> {
    if (this.ctx.closing) return Promise.reject(new Error('Task controller is closing.'));
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
    if (run.agent === 'skaro') {
      const started = await startBuiltinTaskSession(this.ctx, active, artifacts);
      return this.publish(active, started.session, started.segment, !!started.resume);
    }
    const task = findTask(artifacts, taskId);
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

    const segment = active.segments++;
    this.ctx.history.writeLine(active, {
      ts: Date.now() - run.startedAt,
      dir: 'meta',
      line: { skaro: 'segment', agent, adapterVersion: run.adapterVersion },
    });
    active.grant = this.ctx.deps.mcp.grant({ kind: 'task', projectId, taskId, runId: run.id });
    let session: AgentSession;
    try {
      const options = await taskSessionOptions(this.ctx, active, artifacts, settings, segment);
      session = await this.ctx.deps.agents.adapter(agent).start({
        ...options,
        ...(sandbox ? { sandboxVerified: sandbox.holds } : {}),
        ...(sandbox?.mode ? { sandboxMode: sandbox.mode } : {}),
      });
    } catch (error) {
      active.grant.revoke();
      active.grant = undefined;
      if (active.builtinAdmission) {
        const lease = await revokeBuiltinTaskAdmission(active, 'Task session startup failed');
        await confirmBuiltinTaskExit(active, lease);
      }
      if (resume) this.ctx.history.notice(active, 'session_lost', 'error', errorText(error));
      throw error;
    }
    return this.publish(active, session, segment, !!resume);
  }

  private async publish(
    active: ActiveRun,
    session: AgentSession,
    segment: number,
    resume: boolean,
  ) {
    const { projectId, taskId } = active;
    const saved = this.ctx.deps.db.getRun(active.run.id);
    if (
      this.ctx.closing ||
      active.switching ||
      this.ctx.active.get(key(projectId, taskId)) !== active ||
      !saved ||
      saved.agent !== active.run.agent ||
      saved.retiredAt !== undefined
    ) {
      const lease = await revokeBuiltinTaskAdmission(active, 'Task changed during session startup');
      active.grant?.revoke();
      active.grant = undefined;
      try {
        await session.close();
      } finally {
        await this.ctx.processes.stop(active.run.id);
        await confirmBuiltinTaskExit(active, lease);
      }
      throw new Error('Task changed during session startup');
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
        const scoped = segmentTurns(active.run.agent === 'skaro' ? 0 : segment, event);
        this.ctx.events.onEvent(
          active,
          active.run.previousRunId ? runEvent(scoped, active.run.id) : scoped,
        );
      }
    } catch (error) {
      this.ctx.events.failTurn(active, error);
    }
    if (active.session === session && !active.switching) {
      const lease = active.builtinAdmission
        ? await revokeBuiltinTaskAdmission(active, 'Task runtime exited')
        : undefined;
      if (active.session !== session || active.switching) return;
      active.session = undefined;
      active.grant?.revoke();
      active.grant = undefined;
      // A turn still open when the process went away ends here (agent-output.md 6).
      const turn = active.timeline.state.turns.at(-1);
      if (turn && !turn.outcome)
        this.ctx.events.failTurn(active, new Error('The agent process exited'));
      if (lease) await confirmBuiltinTaskExit(active, lease);
      this.ctx.changed(active.projectId, active.taskId);
    }
  }

  async detach(active: ActiveRun): Promise<void> {
    // An attachment already in flight must not publish a new process after cleanup has run.
    active.builtinStartup?.abort(new Error('Builtin task detached during startup'));
    await active.attaching?.catch(() => undefined);
    const lease = active.builtinAdmission
      ? await revokeBuiltinTaskAdmission(active, 'Task session detached')
      : undefined;
    const session = active.session;
    active.session = undefined;
    active.grant?.revoke();
    active.grant = undefined;
    await this.ctx.processes.stop(active.run.id);
    await session?.close().catch(() => undefined);
    if (lease) await confirmBuiltinTaskExit(active, lease);
    this.ctx.history.flush(active);
    // A closed session ends no turn by itself: its slot must not stay taken.
    active.release?.();
    active.release = undefined;
  }

  /** A handoff must prove shutdown; a timeout/error leaves the old run frozen for retry. */
  async stopForHandoff(active: ActiveRun): Promise<void> {
    if (active.builtinStartup) {
      active.builtinStartup.abort(new Error('Builtin task changed agent during startup'));
      await active.attaching?.catch(() => undefined);
    }
    const lease = active.builtinAdmission
      ? await revokeBuiltinTaskAdmission(active, 'Task agent handoff')
      : undefined;
    active.grant?.revoke();
    active.grant = undefined;
    const session = active.session;
    if (session) {
      if (!lease)
        for (const item of active.timeline.state.items)
          if (item.kind === 'command' && item.background?.state === 'running')
            await session.stopBackground(item.background.taskId);
      await this.ctx.processes.stop(active.run.id);
      await session.close();
      await active.pumping;
      active.session = undefined;
    } else await this.ctx.processes.stop(active.run.id);
    if (lease) await confirmBuiltinTaskExit(active, lease);
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
