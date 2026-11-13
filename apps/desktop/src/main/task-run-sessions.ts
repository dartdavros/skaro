import { segmentTurns, runEvent, type AgentSession } from '@skaro/timeline';
import type { AgentId } from '../shared/ipc';
import { errorText } from './session-log';
import { key, settingsKey, findTask } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { taskRunDirectory } from './task-run-directory';
import { closeSessionLog } from './close-session-log';
import { taskSessionOptions } from './task-session-options';
import { startBuiltinTaskSession } from './builtin-task-session';
import { retireNativeSession } from './native/session-retirement';
import { CommandCancelled } from './owner-commands';
import { requireTaskNotStopping } from './builtin-task-stop';
import { forgetTaskRun } from './task-run-forget';

/** sessions: a focused part of the task-run controller. */
export class TaskRunSessions {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  attach(active: ActiveRun): Promise<AgentSession> {
    if (active.suspending) return active.suspending.then(() => this.attach(active));
    try {
      requireTaskNotStopping(active);
    } catch (error) {
      return Promise.reject(error);
    }
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
    const epoch = active.deliveryEpoch;
    const { projectId, taskId, run } = active;
    const context = this.ctx.project(projectId);
    const artifacts = await context.load();
    if (!artifacts.tasks.some((task) => task.id === taskId))
      throw new Error('Milestones have no agent sessions. Use a task or the project chat.');
    if (run.agent === 'skaro') {
      if (active.deliveryEpoch !== epoch) throw new CommandCancelled();
      const started = await startBuiltinTaskSession(this.ctx, active, artifacts);
      return this.publish(active, started.session, started.segment, !!started.resume, epoch);
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
        await retireNativeSession(active, 'Task session startup failed', () =>
          this.ctx.processes.stop(run.id),
        );
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
    epoch?: number,
  ) {
    const { projectId, taskId } = active;
    const saved = this.ctx.deps.db.getRun(active.run.id);
    if (
      this.ctx.closing ||
      (epoch !== undefined && active.deliveryEpoch !== epoch) ||
      active.switching ||
      this.ctx.active.get(key(projectId, taskId)) !== active ||
      !saved ||
      saved.agent !== active.run.agent ||
      saved.retiredAt !== undefined
    ) {
      active.grant?.revoke();
      active.grant = undefined;
      await retireNativeSession(active, 'Task changed during session startup', async () => {
        try {
          await session.close();
        } finally {
          await this.ctx.processes.stop(active.run.id);
        }
      });
      if (epoch !== undefined && active.deliveryEpoch !== epoch) throw new CommandCancelled();
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
      const builtin = !!active.builtinAdmission;
      active.session = undefined;
      const cleanup = async () => {
        active.grant?.revoke();
        active.grant = undefined;
        if (builtin) await this.ctx.processes.stop(active.run.id);
        // A turn still open when the process went away ends here (agent-output.md 6).
        const turn = active.timeline.state.turns.at(-1);
        if (turn && !turn.outcome)
          this.ctx.events.failTurn(active, new Error('The agent process exited'));
      };
      try {
        if (builtin) await retireNativeSession(active, 'Task runtime exited', cleanup);
        else await cleanup();
      } catch (error) {
        active.stopError = errorText(error);
        this.ctx.history.notice(active, 'other', 'error', active.stopError);
      }
      this.ctx.changed(active.projectId, active.taskId);
    }
  }

  async detach(active: ActiveRun): Promise<void> {
    // An attachment already in flight must not publish a new process after cleanup has run.
    active.builtinStartup?.abort(new Error('Builtin task detached during startup'));
    await active.attaching?.catch(() => undefined);
    const builtin = !!active.builtinAdmission;
    const session = active.session;
    active.session = undefined;
    active.grant?.revoke();
    active.grant = undefined;
    try {
      await retireNativeSession(active, 'Task session detached', async () => {
        try {
          await this.ctx.processes.stop(active.run.id);
        } finally {
          if (builtin) await session?.close();
          else await session?.close().catch(() => undefined);
        }
      });
    } finally {
      this.ctx.history.flush(active);
      // A closed session ends no turn by itself: its slot must not stay taken.
      active.release?.();
      active.release = undefined;
    }
  }

  /** A handoff must prove shutdown; a timeout/error leaves the old run frozen for retry. */
  async stopForHandoff(active: ActiveRun): Promise<void> {
    if (active.builtinStartup) {
      active.builtinStartup.abort(new Error('Builtin task changed agent during startup'));
      await active.attaching?.catch(() => undefined);
    }
    if (active.builtinAdmission) {
      const session = active.session;
      active.session = undefined;
      return retireNativeSession(active, 'Task agent handoff', async () => {
        active.grant?.revoke();
        active.grant = undefined;
        try {
          await this.ctx.processes.stop(active.run.id);
        } finally {
          await session?.close();
        }
        await active.pumping;
      });
    }
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
    await this.ctx.architecture.close();
    await this.ctx.cleanup.close();
    // Releasing a review slot during shutdown must not launch a queued agent turn.
    for (const queued of this.ctx.queue.state().queued) this.ctx.queue.cancel(queued);
    await this.ctx.reviews.close();
    await this.ctx.integrations.close();
    await this.ctx.merges.close();
    await Promise.all([...this.ctx.active.values()].map((a) => this.detach(a)));
    await Promise.allSettled(this.ctx.incidentCaptures);
    await this.ctx.incidents.idle();
    await Promise.all([...this.ctx.active.values()].map((active) => closeSessionLog(active.log)));
    await this.ctx.environments
      .close()
      .catch((error) => console.error('Environment shutdown:', error));
    await this.ctx.environments.idle();
  }

  async forget(projectId: string, taskId: string): Promise<void> {
    return forgetTaskRun(this.ctx, projectId, taskId);
  }
}
