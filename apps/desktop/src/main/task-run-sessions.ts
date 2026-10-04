import { existsSync } from 'node:fs';
import { segmentTurns, type AgentSession } from '@skaro/timeline';
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

const ENVIRONMENT_TOOL_TIMEOUT_MS = 30 * 60_000;

/** sessions: a focused part of the task-run controller. */
export class TaskRunSessions {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  attach(active: ActiveRun): Promise<AgentSession> {
    if (active.session) return Promise.resolve(active.session);
    active.attaching ??= this.startSession(active).finally(() => (active.attaching = undefined));
    return active.attaching;
  }

  async startSession(active: ActiveRun): Promise<AgentSession> {
    const { projectId, taskId, run } = active;
    const context = this.ctx.project(projectId);
    const artifacts = await context.load();
    const task = findTask(artifacts, taskId);
    const agent = run.agent as AgentId;
    await this.ctx.views.ensureAgent(agent);
    const settings = await this.ctx.views.withDefaults(
      agent,
      context.root,
      this.ctx.views.settings(projectId, task, artifacts),
    );
    const sandbox =
      settings.permissionMode === 'auto' ? await this.ctx.deps.agents.sandbox(agent) : undefined;
    const resume = run.nativeSessionId;
    // Completed runs retain their worktree; old runs whose folder is gone use the main copy.
    const inWorktree = run.worktree !== undefined && existsSync(run.worktree);
    const cwd = inWorktree ? run.worktree! : context.root;

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
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.effort ? { effort: settings.effort } : {}),
        permissionMode: settings.permissionMode,
        planFirst: settings.planFirst,
        instructions: acceptance
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
            }),
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
        raw: (line) =>
          this.ctx.history.writeLine(active, { ...line, ts: Date.now() - run.startedAt }),
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
    void this.pump(active, session, segment);
    this.ctx.changed(projectId, taskId);
    return session;
  }

  async pump(active: ActiveRun, session: AgentSession, segment: number): Promise<void> {
    try {
      for await (const event of session.events) {
        this.ctx.events.onEvent(active, segmentTurns(segment, event));
      }
    } catch (error) {
      this.ctx.events.failTurn(active, error);
    }
    if (active.session === session) {
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
    const session = active.session;
    active.session = undefined;
    active.grant?.revoke();
    active.grant = undefined;
    await session?.close().catch(() => undefined);
    this.ctx.history.flush(active);
    // A closed session ends no turn by itself: its slot must not stay taken.
    active.release?.();
    active.release = undefined;
  }

  async close(): Promise<void> {
    this.ctx.merges.close();
    await Promise.all([...this.ctx.active.values()].map((a) => this.detach(a)));
    for (const active of this.ctx.active.values()) active.log?.end();
  }

  async forget(projectId: string, taskId: string): Promise<void> {
    const k = key(projectId, taskId);
    this.ctx.queue.cancel(k);
    this.ctx.queuedInputs.delete(k);
    const git = this.ctx.project(projectId).git;
    const runs = this.ctx.deps.db.listRuns(projectId, taskId);
    // The checkout, the branch and the environment of a stage belong to its other tasks too:
    // deleting one task leaves them alone.
    const own = runs.filter(ownsCheckout);
    // The disposable environment goes first: its containers would hold the checkout.
    if (own.length === runs.length) await this.ctx.removeEnvironment({ projectId, taskId });
    // Check every retained folder before mutating sessions, records or branches.
    for (const run of own) if (run.worktree) await git.assertRemovableWorktree(run.worktree);
    const active = this.ctx.active.get(k);
    if (active) {
      await this.detach(active);
      active.log?.end();
      this.ctx.active.delete(k);
    }
    for (const run of runs) {
      if (!run.endedAt) this.ctx.deps.db.finishRun(run.id, 'interrupted');
      if (!ownsCheckout(run)) continue;
      if (run.worktree) await git.removeWorktree(run.worktree);
      if (run.branch) await git.deleteBranch(run.branch);
    }
    this.ctx.deps.db.setSetting(settingsKey(projectId, taskId), null);
    this.ctx.setRuntime(projectId, taskId, 'idle');
    await this.ctx.stages.sync(projectId, taskId);
  }
}
