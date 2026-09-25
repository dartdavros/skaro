// Task runs (architecture.md 7–8, D-27): a worktree and an agent session per task, the raw log as
// the source of truth, the timeline kept here and streamed to the renderer, statuses, and the
// merge confirmed in the task chat.

import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ClaudeProjector } from '@skaro/adapter-claude';
import { CodexProjector } from '@skaro/adapter-codex';
import {
  displayStatus,
  indexTasks,
  isBlocked,
  MergeBlockedError,
  newlyUnblocked,
  RunQueue,
  taskBranch,
  type AppDb,
  type AttachmentStore,
  type MergeCheck,
  type ProjectArtifacts,
  type RunRecord,
  type Task,
  type TaskRuntime,
} from '@skaro/core';
import type {
  Grant,
  McpHttpServer,
  MergeTaskArgs,
  SkaroScope,
  ToolResult,
} from '@skaro/mcp-server';
import {
  replayRunLog,
  Timeline,
  type AgentSession,
  type Emit,
  type Interaction,
  type InteractionAnswer,
  type ProjectionContext,
  type Projector,
  type RawLine,
  type TimelineEvent,
} from '@skaro/timeline';
import type {
  AgentId,
  AgentSettings,
  Events,
  EventName,
  MergeAction,
  MessageInput,
  RunInfo,
  TaskDetail,
  TaskRef,
  TaskSummary,
  TaskView,
} from '../shared/ipc';
import type { AgentManager } from './agents';
import type { ProjectContext, Projects } from './projects';
import { taskInstructions } from './prompt';
import { taskSections, toggleCriterion, withSummary } from './task-body';

type MergeInteraction = Extract<Interaction, { kind: 'merge' }>;

interface Deps {
  db: AppDb;
  /** App data folder: runs/, worktrees/. */
  dataDir: string;
  projects: Projects;
  agents: AgentManager;
  attachments: AttachmentStore;
  mcp: McpHttpServer<SkaroScope>;
  emit: <E extends EventName>(event: E, payload: Events[E]) => void;
  locale: () => string;
}

/** A task's latest run, with or without an agent process attached. */
class ActiveRun {
  readonly projectId: string;
  readonly taskId: string;
  run: RunRecord;
  readonly timeline: Timeline;
  session: AgentSession | undefined;
  grant: Grant | undefined;
  log: WriteStream | undefined;
  /** Events not yet sent to the renderer. */
  pending: TimelineEvent[] = [];
  /** Events applied to the timeline so far. */
  seq = 0;
  flushTimer: NodeJS.Timeout | undefined;
  /** Resolves the queue slot when the first turn ends. */
  release: (() => void) | undefined;
  /** Summary the agent gave to merge_task. */
  mergeSummary: string | undefined;
  /** Serializes session start and resume. */
  attaching: Promise<AgentSession> | undefined;
  /** Work that waits for the running turn to end (cleanup after a merge). */
  afterTurn: (() => Promise<void>) | undefined;

  constructor(projectId: string, taskId: string, run: RunRecord, timeline: Timeline) {
    this.projectId = projectId;
    this.taskId = taskId;
    this.run = run;
    this.timeline = timeline;
  }
}

const FLUSH_MS = 40;

export class TaskRuns {
  private readonly deps: Deps;
  private readonly active = new Map<string, ActiveRun>();
  /** First message of a task waiting for a slot. */
  private readonly firstInputs = new Map<string, MessageInput>();
  private readonly queue: RunQueue;

  constructor(deps: Deps, slots = 3) {
    this.deps = deps;
    this.queue = new RunQueue({
      slots,
      canRun: () => undefined,
      start: (key) => this.begin(key),
    });
    this.queue.on((event) => {
      const [projectId, taskId] = event.taskId.split('\n') as [string, string];
      if (event.type === 'queued') this.setRuntime(projectId, taskId, 'queued');
      if (event.type === 'finished' && event.error) {
        this.setRuntime(projectId, taskId, 'idle');
      }
    });
  }

  // ── views ────────────────────────────────────────────────────────────────

  async list(projectId: string): Promise<TaskSummary[]> {
    const artifacts = await this.project(projectId).load();
    const runtime = this.deps.db.getTaskRuntime(projectId);
    const index = indexTasks(artifacts.tasks);
    return artifacts.tasks.map((task) =>
      summary(task, artifacts, index, runtime.get(task.id)?.state),
    );
  }

  async open(projectId: string, taskId: string): Promise<TaskView> {
    const artifacts = await this.project(projectId).load();
    const task = findTask(artifacts, taskId);
    const active =
      this.active.get(key(projectId, taskId)) ?? (await this.restore(projectId, taskId));
    const runtime = this.deps.db.getTaskRuntime(projectId);
    const settings = this.settings(projectId, task, artifacts);
    const sandbox = this.deps.db.getSetting<{ holds?: boolean } | null>(
      `agents.${settings.agent}.sandbox`,
      null,
    );
    return {
      projectId,
      task: detail(task, artifacts, runtime),
      settings,
      ...(active ? { run: runInfo(active), timeline: active.timeline.state } : {}),
      seq: active?.seq ?? 0,
      queued: this.queue.state().queued.includes(key(projectId, taskId)),
      slotsFree: this.queue.state().running.length < this.queue.state().slots,
      ...(sandbox?.holds !== undefined ? { sandboxHolds: sandbox.holds } : {}),
    };
  }

  /** Folder the task's agent works in: its worktree while it exists, else the project. */
  workdir(projectId: string, taskId: string): string {
    const worktree = this.active.get(key(projectId, taskId))?.run.worktree;
    return worktree && existsSync(worktree) ? worktree : this.project(projectId).root;
  }

  async toggleCriterion(projectId: string, taskId: string, index: number): Promise<void> {
    const context = this.project(projectId);
    const task = await context.store.readTask(taskId);
    await context.store.updateTask(taskId, { body: toggleCriterion(task.body, index) });
    this.changed(projectId, taskId);
  }

  // ── settings ─────────────────────────────────────────────────────────────

  settings(projectId: string, task: Task, artifacts: ProjectArtifacts): AgentSettings {
    const saved = this.deps.db.getSetting<Partial<AgentSettings> | null>(
      settingsKey(projectId, task.id),
      null,
    );
    const agent = (saved?.agent ?? task.agent ?? artifacts.config.defaultAgent) as AgentId;
    const model = saved?.model ?? task.model ?? artifacts.config.defaultModel;
    return {
      agent: agent === 'codex' ? 'codex' : 'claude-code',
      ...(model ? { model } : {}),
      ...(saved?.effort ? { effort: saved.effort } : {}),
      permissionMode: saved?.permissionMode ?? 'auto',
      planFirst: saved?.planFirst ?? false,
      isolation: saved?.isolation ?? artifacts.config.isolation,
    };
  }

  /** Saves the task's agent settings; model and permission mode apply to a live session now. */
  async setSettings(projectId: string, taskId: string, next: AgentSettings): Promise<void> {
    const artifacts = await this.project(projectId).load();
    const task = findTask(artifacts, taskId);
    const before = this.settings(projectId, task, artifacts);
    const active = this.active.get(key(projectId, taskId));
    if (active && next.agent !== active.run.agent) {
      throw new Error('The agent of a started task cannot be changed');
    }
    this.deps.db.setSetting(settingsKey(projectId, taskId), next);
    const session = active?.session;
    if (session) {
      if (next.model && (next.model !== before.model || next.effort !== before.effort)) {
        await session.setModel(next.model, next.effort);
      }
      if (next.permissionMode !== before.permissionMode) {
        await session.setPermissionMode(next.permissionMode);
      }
    }
    this.changed(projectId, taskId);
  }

  // ── conversation ─────────────────────────────────────────────────────────

  /** A message in the task chat: starts the task, continues it, or steers the running turn. */
  async send(projectId: string, taskId: string, input: MessageInput): Promise<void> {
    const k = key(projectId, taskId);
    const active = this.active.get(k) ?? (await this.restore(projectId, taskId));
    if (!active) return this.start(projectId, taskId, input);
    const session = await this.attach(active);
    if (active.timeline.state.status === 'idle') await session.send(input);
    else await session.steer(input);
  }

  async respond(
    projectId: string,
    taskId: string,
    interactionId: string,
    answer: InteractionAnswer,
  ): Promise<void> {
    const active = this.requireActive(projectId, taskId);
    if (!active.session) throw new Error('The agent session has ended');
    const interaction = active.timeline.state.interactions.find((i) => i.id === interactionId);
    await active.session.respond(interactionId, answer);
    if (!interaction) return;
    // The decision stays in the feed (and the log) after the card closes.
    this.skaroEvent(active, {
      t: 'item.upsert',
      item: {
        id: `skaro-decision-${interactionId}`,
        turnId: active.timeline.state.turns.at(-1)?.id ?? '',
        kind: 'decision',
        interaction,
        answer: withoutSecrets(interaction, answer),
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'decision', ref: interactionId },
      },
    });
  }

  async interrupt(projectId: string, taskId: string): Promise<void> {
    const k = key(projectId, taskId);
    if (this.queue.cancel(k)) {
      this.firstInputs.delete(k);
      this.setRuntime(projectId, taskId, 'idle');
      return;
    }
    await this.active.get(k)?.session?.interrupt();
  }

  async rewind(
    projectId: string,
    taskId: string,
    itemId: string,
    resend?: MessageInput,
  ): Promise<void> {
    const active = this.requireActive(projectId, taskId);
    const session = await this.attach(active);
    await session.rewind(itemId);
    if (resend) await session.send(resend);
  }

  async stopBackground(projectId: string, taskId: string, backgroundId: string): Promise<void> {
    await this.requireActive(projectId, taskId).session?.stopBackground(backgroundId);
  }

  // ── merge (D-27) ─────────────────────────────────────────────────────────

  /** `merge_task` from the agent: commit leftovers, check, show the confirmation card. */
  async mergeTask(args: MergeTaskArgs, scope: SkaroScope): Promise<ToolResult> {
    if (!scope.taskId) return { text: 'merge_task works only in a task session.', isError: true };
    const active = this.active.get(key(scope.projectId, scope.taskId));
    if (!active || active.run.id !== scope.runId) {
      return { text: 'This session is no longer the current run of the task.', isError: true };
    }
    const { worktree, branch } = active.run;
    if (!worktree || !branch) {
      return {
        text: 'The task runs in the main working copy: there is no task branch to merge.',
        isError: true,
      };
    }
    const context = this.project(active.projectId);
    const artifacts = await context.load();
    const task = findTask(artifacts, active.taskId);
    await context.git.commitAll(worktree, `${task.id}: ${task.title}`);
    const check = await context.git.checkMerge(artifacts.config.baseBranch, branch);
    if (args.summary) active.mergeSummary = args.summary;

    const previous = active.timeline.state.interactions.find((i) => i.kind === 'merge');
    if (previous)
      this.skaroEvent(active, {
        t: 'interaction.closed',
        id: previous.id,
        resolution: 'cancelled',
      });
    const interaction = mergeInteraction(randomUUID(), branch, artifacts.config.baseBranch, check);
    this.skaroEvent(active, { t: 'interaction.opened', interaction });
    this.setRuntime(active.projectId, active.taskId, 'waiting');
    return { text: mergeToolReply(interaction) };
  }

  async merge(
    projectId: string,
    taskId: string,
    interactionId: string,
    action: MergeAction,
  ): Promise<void> {
    const active = this.requireActive(projectId, taskId);
    const card = active.timeline.state.interactions.find(
      (i): i is MergeInteraction => i.kind === 'merge' && i.id === interactionId,
    );
    if (!card) throw new Error('The merge card is closed');
    const context = this.project(projectId);
    const artifacts = await context.load();
    const base = artifacts.config.baseBranch;
    const branch = active.run.branch!;

    switch (action.action) {
      case 'cancel':
        this.skaroEvent(active, { t: 'interaction.closed', id: card.id, resolution: 'cancelled' });
        this.settleRuntime(active);
        return;
      case 'update_branch': {
        const result = await context.git.rebase(active.run.worktree!, base);
        const check = await context.git.checkMerge(base, branch);
        const next = mergeInteraction(card.id, branch, base, check);
        if (!result.ok) next.conflicts = result.conflicts;
        this.skaroEvent(active, { t: 'interaction.opened', interaction: next });
        return;
      }
      case 'resolve_with_agent': {
        this.skaroEvent(active, { t: 'interaction.closed', id: card.id, resolution: 'cancelled' });
        const session = await this.attach(active);
        const files = card.conflicts.map((f) => `- ${f}`).join('\n');
        await session.send({
          text:
            `Слияние ветки ${branch} в ${base} даёт конфликты:\n${files}\n\n` +
            `Перенеси ветку на свежую ${base} (git rebase ${base}), разреши конфликты, закоммить ` +
            `результат и снова вызови merge_task.`,
        });
        return;
      }
      case 'confirm':
        await this.confirmMerge(active, context, card, action.message);
    }
  }

  private async confirmMerge(
    active: ActiveRun,
    context: ProjectContext,
    card: MergeInteraction,
    message: string,
  ): Promise<void> {
    const artifacts = await context.load();
    const task = findTask(artifacts, active.taskId);
    const base = artifacts.config.baseBranch;
    const branch = active.run.branch!;
    const summaryText = active.mergeSummary ?? lastAgentText(active);
    let result: { commit: string; check: MergeCheck };
    try {
      result = await context.git.merge({
        base,
        branch,
        strategy: artifacts.config.merge.strategy,
        message: message.trim() || `${task.id}: ${task.title}`,
        beforeCommit: async () => {
          const updated = await context.store.updateTask(task.id, {
            status: 'done',
            ...(summaryText ? { body: withSummary(task.body, summaryText) } : {}),
          });
          return [updated.path];
        },
      });
    } catch (error) {
      if (error instanceof MergeBlockedError) {
        this.skaroEvent(active, {
          t: 'interaction.opened',
          interaction: mergeInteraction(card.id, branch, base, error.check),
        });
      }
      context.invalidate();
      throw error;
    }
    context.invalidate();
    const after = await context.load();

    this.deps.db.recordMerge({
      projectId: active.projectId,
      taskId: task.id,
      branch,
      commit: result.commit,
      strategy: artifacts.config.merge.strategy,
    });
    this.skaroEvent(active, { t: 'interaction.closed', id: card.id, resolution: 'answered' });
    const unblocked = newlyUnblocked(artifacts.tasks, after.tasks);
    this.skaroEvent(active, {
      t: 'item.upsert',
      item: {
        id: `skaro-merged-${card.id}`,
        turnId: active.timeline.state.turns.at(-1)?.id ?? '',
        kind: 'notice',
        level: 'info',
        code: 'merged',
        text: base,
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'merged', ref: result.commit },
      },
    });

    for (const id of unblocked) this.changed(active.projectId, id);
    this.deps.emit('project.changed', { projectId: active.projectId });

    // The task is done: the agent session, the worktree and (by config) the branch go away —
    // after the agent finishes its reply, so the turn is not cut off and the folder is free.
    const cleanup = async (): Promise<void> => {
      await this.detach(active);
      this.deps.db.finishRun(active.run.id, 'done');
      await context.git.removeWorktree(active.run.worktree!, {
        ...(artifacts.config.merge.deleteBranch ? { deleteBranch: branch } : {}),
      });
      this.setRuntime(active.projectId, active.taskId, 'idle');
      this.changed(active.projectId, active.taskId);
    };
    if (active.session && active.timeline.state.status !== 'idle') active.afterTurn = cleanup;
    else await cleanup();
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  private async start(projectId: string, taskId: string, input: MessageInput): Promise<void> {
    const artifacts = await this.project(projectId).load();
    const task = findTask(artifacts, taskId);
    if (task.archived) throw new Error('The task is archived');
    if (isBlocked(task, indexTasks(artifacts.tasks))) throw new Error('The task is blocked');
    const settings = this.settings(projectId, task, artifacts);
    await this.ensureAgent(settings.agent);
    const k = key(projectId, taskId);
    this.firstInputs.set(k, input);
    const result = this.queue.enqueue([k]);
    if (!result.accepted.length) this.firstInputs.delete(k);
    this.changed(projectId, taskId);
  }

  /** Queue slot granted: worktree, run record, agent session, first message. */
  private async begin(k: string): Promise<void> {
    const [projectId, taskId] = k.split('\n') as [string, string];
    const input = this.firstInputs.get(k) ?? { text: '' };
    this.firstInputs.delete(k);
    const context = this.project(projectId);
    const artifacts = await context.load();
    const task = findTask(artifacts, taskId);
    const settings = this.settings(projectId, task, artifacts);

    let worktree: string | undefined;
    let branch: string | undefined;
    if (settings.isolation === 'worktree') {
      branch = task.branch ?? taskBranch(artifacts.config, task);
      worktree = join(this.deps.dataDir, 'worktrees', projectId, taskId);
      if (existsSync(worktree)) await context.git.removeWorktree(worktree);
      await mkdir(dirname(worktree), { recursive: true });
      await context.git.createWorktree({
        path: worktree,
        branch,
        base: artifacts.config.baseBranch,
      });
    }
    await context.store.updateTask(taskId, {
      status: 'in_progress',
      ...(branch ? { branch } : {}),
    });
    context.invalidate();

    const logPath = join(
      'runs',
      projectId,
      taskId,
      `${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`,
    );
    const adapter = this.deps.agents.adapter(settings.agent);
    const run = this.deps.db.createRun({
      projectId,
      taskId,
      agent: settings.agent,
      ...(settings.model ? { model: settings.model } : {}),
      ...(worktree ? { worktree } : {}),
      ...(branch ? { branch } : {}),
      logPath,
      adapterVersion: adapter.adapterVersion,
    });
    const active = new ActiveRun(projectId, taskId, run, new Timeline());
    this.active.set(k, active);
    this.setRuntime(projectId, taskId, 'running', run.id);
    this.deps.emit('project.changed', { projectId });

    const done = new Promise<void>((resolve) => (active.release = resolve));
    try {
      const session = await this.attach(active);
      await session.send(input);
    } catch (error) {
      active.release = undefined;
      this.failTurn(active, error);
      throw error;
    }
    await done;
  }

  /** The live session of a run; resumes the agent's session when none is attached. */
  private attach(active: ActiveRun): Promise<AgentSession> {
    if (active.session) return Promise.resolve(active.session);
    active.attaching ??= this.startSession(active).finally(() => (active.attaching = undefined));
    return active.attaching;
  }

  private async startSession(active: ActiveRun): Promise<AgentSession> {
    const { projectId, taskId, run } = active;
    const context = this.project(projectId);
    const artifacts = await context.load();
    const task = findTask(artifacts, taskId);
    const agent = run.agent as AgentId;
    await this.ensureAgent(agent);
    const settings = await this.withDefaults(
      agent,
      context.root,
      this.settings(projectId, task, artifacts),
    );
    const sandbox =
      settings.permissionMode === 'auto' ? await this.deps.agents.sandbox(agent) : undefined;
    const resume = run.nativeSessionId;
    const cwd = run.worktree ?? context.root;

    this.writeLine(active, {
      ts: Date.now() - run.startedAt,
      dir: 'meta',
      line: { skaro: 'segment', agent, adapterVersion: run.adapterVersion },
    });
    active.grant = this.deps.mcp.grant({ kind: 'task', projectId, taskId, runId: run.id });
    let session: AgentSession;
    try {
      session = await this.deps.agents.adapter(agent).start({
        cwd,
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.effort ? { effort: settings.effort } : {}),
        permissionMode: settings.permissionMode,
        planFirst: settings.planFirst,
        instructions: taskInstructions({
          task,
          artifacts,
          cwd,
          ...(run.branch ? { branch: run.branch } : {}),
          locale: this.deps.locale(),
        }),
        mcpServers: {
          skaro: { type: 'http', url: active.grant.url, headers: active.grant.headers },
        },
        ...(sandbox ? { sandboxVerified: sandbox.holds } : {}),
        ...(sandbox?.mode ? { sandboxMode: sandbox.mode } : {}),
        ...(resume ? { resume } : {}),
        raw: (line) => this.writeLine(active, { ...line, ts: Date.now() - run.startedAt }),
        context: this.deps.attachments.context(),
      });
    } catch (error) {
      active.grant.revoke();
      active.grant = undefined;
      if (resume) this.notice(active, 'session_lost', 'error', errorText(error));
      throw error;
    }
    active.session = session;
    if (resume) this.notice(active, 'session_restored', 'info', '');
    void this.pump(active, session);
    this.changed(projectId, taskId);
    return session;
  }

  private async pump(active: ActiveRun, session: AgentSession): Promise<void> {
    try {
      for await (const event of session.events) this.onEvent(active, event);
    } catch (error) {
      this.failTurn(active, error);
    }
    if (active.session === session) {
      active.session = undefined;
      active.grant?.revoke();
      active.grant = undefined;
      // A turn still open when the process went away ends here (agent-output.md 6).
      const turn = active.timeline.state.turns.at(-1);
      if (turn && !turn.outcome) this.failTurn(active, new Error('The agent process exited'));
      this.changed(active.projectId, active.taskId);
    }
  }

  private onEvent(active: ActiveRun, event: TimelineEvent): void {
    active.timeline.apply(event);
    active.seq++;
    active.pending.push(event);
    active.flushTimer ??= setTimeout(() => this.flush(active), FLUSH_MS);
    const { projectId, taskId } = active;
    switch (event.t) {
      case 'session.started':
        if (event.nativeSessionId && event.nativeSessionId !== active.run.nativeSessionId) {
          this.deps.db.setRunSession(active.run.id, event.nativeSessionId);
          active.run = { ...active.run, nativeSessionId: event.nativeSessionId };
        }
        return;
      case 'turn.started':
        this.setRuntime(projectId, taskId, 'running', active.run.id);
        return;
      case 'interaction.opened':
        this.setRuntime(projectId, taskId, 'waiting', active.run.id);
        return;
      case 'interaction.closed':
        if (!active.timeline.state.interactions.length) {
          this.setRuntime(projectId, taskId, 'running', active.run.id);
        }
        return;
      case 'turn.completed':
        void this.onTurnCompleted(active, event.outcome);
        return;
    }
  }

  private async onTurnCompleted(
    active: ActiveRun,
    outcome: 'done' | 'interrupted' | 'failed',
  ): Promise<void> {
    this.settleRuntime(active);
    active.release?.();
    active.release = undefined;
    const after = active.afterTurn;
    if (after) {
      active.afterTurn = undefined;
      await after().catch((error: unknown) =>
        this.notice(active, 'other', 'error', errorText(error)),
      );
      return;
    }
    const context = this.project(active.projectId);
    try {
      const task = await context.store.readTask(active.taskId);
      const status = outcome === 'failed' ? 'failed' : 'review';
      if (task.status !== 'done' && task.status !== status) {
        await context.store.updateTask(active.taskId, { status });
        context.invalidate();
        this.deps.emit('project.changed', { projectId: active.projectId });
      }
    } catch {
      // The task file is gone or broken: the feed still works.
    }
    this.changed(active.projectId, active.taskId);
  }

  /** Runtime after a turn: waiting while a merge card is open, idle otherwise. */
  private settleRuntime(active: ActiveRun): void {
    const s = active.timeline.state;
    const state: TaskRuntime = s.interactions.length
      ? 'waiting'
      : s.status === 'idle'
        ? 'idle'
        : 'running';
    this.setRuntime(active.projectId, active.taskId, state, active.run.id);
  }

  private failTurn(active: ActiveRun, error: unknown): void {
    const turn = active.timeline.state.turns.at(-1);
    if (turn && !turn.outcome) {
      for (const i of active.timeline.state.interactions) {
        if (i.kind !== 'merge')
          this.skaroEvent(active, { t: 'interaction.closed', id: i.id, resolution: 'expired' });
      }
      this.skaroEvent(active, {
        t: 'turn.completed',
        turnId: turn.id,
        outcome: 'failed',
        error: { category: 'other', message: errorText(error) },
      });
    } else {
      this.notice(active, 'other', 'error', errorText(error));
      this.settleRuntime(active);
      active.release?.();
      active.release = undefined;
    }
  }

  /** Latest run of a task from AppDb, rebuilt from its raw log (principle P2). */
  private async restore(projectId: string, taskId: string): Promise<ActiveRun | undefined> {
    const k = key(projectId, taskId);
    const existing = this.active.get(k);
    if (existing) return existing;
    const run = this.deps.db.listRuns(projectId, taskId)[0];
    if (!run) return undefined;
    const lines = await readRunLog(join(this.deps.dataDir, run.logPath));
    const again = this.active.get(k);
    if (again) return again;
    const events = replayRunLog(lines, run.startedAt, projectorFor(run.agent), (image) =>
      this.deps.attachments.save(image),
    );
    const active = new ActiveRun(projectId, taskId, run, Timeline.from(events));
    active.seq = events.length;
    this.active.set(k, active);
    // Nothing survives a restart: an open turn ends as interrupted, its questions expire.
    const turn = active.timeline.state.turns.at(-1);
    if (turn && !turn.outcome) {
      for (const i of active.timeline.state.interactions) {
        if (i.kind !== 'merge')
          this.skaroEvent(active, { t: 'interaction.closed', id: i.id, resolution: 'expired' });
      }
      this.skaroEvent(active, { t: 'turn.completed', turnId: turn.id, outcome: 'interrupted' });
    }
    this.settleRuntime(active);
    return active;
  }

  private async detach(active: ActiveRun): Promise<void> {
    const session = active.session;
    active.session = undefined;
    active.grant?.revoke();
    active.grant = undefined;
    await session?.close().catch(() => undefined);
    this.flush(active);
  }

  async close(): Promise<void> {
    await Promise.all([...this.active.values()].map((a) => this.detach(a)));
    for (const active of this.active.values()) active.log?.end();
  }

  // ── plumbing ─────────────────────────────────────────────────────────────

  /**
   * Model and effort are always set explicitly, never inherited from the user's agent settings
   * (agent-output.md 9.1: an inherited "xhigh" effort burned through a subscription limit).
   */
  private async withDefaults(
    agent: AgentId,
    cwd: string,
    settings: AgentSettings,
  ): Promise<AgentSettings> {
    if (settings.model && settings.effort) return settings;
    const models = await this.deps.agents.listModels(agent, cwd).catch(() => []);
    const model =
      models.find((m) => m.id === settings.model) ?? models.find((m) => m.isDefault) ?? models[0];
    if (!model) return settings;
    const effort =
      settings.effort ??
      model.defaultEffort ??
      (model.efforts.some((e) => e.id === 'medium') ? 'medium' : model.efforts[0]?.id);
    return { ...settings, model: model.id, ...(effort ? { effort } : {}) };
  }

  private async ensureAgent(agent: AgentId): Promise<void> {
    let info = this.deps.agents.list().find((a) => a.id === agent);
    if (!info?.installed) {
      await this.deps.agents.install(agent);
      info = await this.deps.agents.refreshOne(agent);
    }
    if (info.authenticated === false) {
      throw new Error(`${agent === 'codex' ? 'Codex' : 'Claude Code'} is not signed in`);
    }
  }

  /** An event Skaro itself adds to the feed; written to the log so replays keep it. */
  private skaroEvent(active: ActiveRun, event: TimelineEvent): void {
    this.writeLine(active, {
      ts: Date.now() - active.run.startedAt,
      dir: 'meta',
      line: { skaro: 'event', event },
    });
    this.onEvent(active, event);
  }

  private notice(
    active: ActiveRun,
    code: 'session_restored' | 'session_lost' | 'other',
    level: 'info' | 'error',
    text: string,
  ): void {
    this.skaroEvent(active, {
      t: 'item.upsert',
      item: {
        id: `skaro-${code}-${randomUUID()}`,
        turnId: active.timeline.state.turns.at(-1)?.id ?? '',
        kind: 'notice',
        level,
        code,
        text,
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: code, ref: '' },
      },
    });
  }

  private writeLine(active: ActiveRun, line: RawLine): void {
    if (!active.log) {
      const path = join(this.deps.dataDir, active.run.logPath);
      mkdirSync(dirname(path), { recursive: true });
      const log = createWriteStream(path, { flags: 'a' });
      // A failing disk must not take the app down; the live feed keeps working.
      log.on('error', (error) => console.error(`run log ${path}: ${error.message}`));
      active.log = log;
    }
    active.log.write(`${JSON.stringify(line)}\n`);
  }

  private flush(active: ActiveRun): void {
    clearTimeout(active.flushTimer);
    active.flushTimer = undefined;
    if (!active.pending.length) return;
    const events = active.pending;
    active.pending = [];
    this.deps.emit('task.events', {
      projectId: active.projectId,
      taskId: active.taskId,
      runId: active.run.id,
      seq: active.seq - events.length,
      events,
    });
  }

  private setRuntime(projectId: string, taskId: string, state: TaskRuntime, runId?: string): void {
    const current = this.deps.db.getTaskRuntime(projectId).get(taskId);
    if (current?.state === state && current.runId === runId) return;
    this.deps.db.setTaskRuntime(projectId, taskId, state, runId);
    this.changed(projectId, taskId);
    this.deps.emit('project.changed', { projectId });
  }

  private changed(projectId: string, taskId: string): void {
    this.deps.emit('task.changed', { projectId, taskId });
  }

  private project(projectId: string): ProjectContext {
    return this.deps.projects.get(projectId);
  }

  private requireActive(projectId: string, taskId: string): ActiveRun {
    const active = this.active.get(key(projectId, taskId));
    if (!active) throw new Error('The task has no run');
    return active;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

function key(projectId: string, taskId: string): string {
  return `${projectId}\n${taskId}`;
}

function settingsKey(projectId: string, taskId: string): string {
  return `task.${projectId}.${taskId}.agent`;
}

function findTask(artifacts: ProjectArtifacts, taskId: string): Task {
  const task = artifacts.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`unknown task ${taskId}`);
  return task;
}

function projectorFor(agent: string): (ctx: ProjectionContext, emit: Emit) => Projector {
  return agent === 'codex'
    ? (ctx, emit) => new CodexProjector(ctx, emit)
    : (ctx, emit) => new ClaudeProjector(ctx, emit);
}

async function readRunLog(path: string): Promise<RawLine[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const lines: RawLine[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line) as RawLine);
    } catch {
      // A line cut by a crash: the rest of the log still counts.
    }
  }
  return lines;
}

function runInfo(active: ActiveRun): RunInfo {
  return {
    id: active.run.id,
    agent: active.run.agent as AgentId,
    startedAt: active.run.startedAt,
    ...(active.run.worktree ? { worktree: active.run.worktree } : {}),
    ...(active.run.branch ? { branch: active.run.branch } : {}),
    live: active.session !== undefined,
  };
}

function ref(task: Task, index: ReturnType<typeof indexTasks>, runtime?: TaskRuntime): TaskRef {
  return { id: task.id, title: task.title, status: displayStatus(task, index, runtime) };
}

function summary(
  task: Task,
  artifacts: ProjectArtifacts,
  index: ReturnType<typeof indexTasks>,
  runtime?: TaskRuntime,
): TaskSummary {
  const milestone = artifacts.milestones.find((m) => m.id === task.milestone);
  return {
    ...ref(task, index, runtime),
    ...(milestone ? { milestone: { id: milestone.id, title: milestone.title } } : {}),
    archived: task.archived,
  };
}

function detail(
  task: Task,
  artifacts: ProjectArtifacts,
  runtime: Map<string, { state: TaskRuntime }>,
): TaskDetail {
  const index = indexTasks(artifacts.tasks);
  const refOf = (t: Task) => ref(t, index, runtime.get(t.id)?.state);
  return {
    ...summary(task, artifacts, index, runtime.get(task.id)?.state),
    dependsOn: task.dependsOn.map(
      (id) => (index.get(id) && refOf(index.get(id)!)) ?? { id, title: id, status: 'todo' },
    ),
    blocks: artifacts.tasks.filter((t) => t.dependsOn.includes(task.id)).map(refOf),
    ...(task.branch ? { branch: task.branch } : {}),
    ...taskSections(task.body),
  };
}

function mergeInteraction(
  id: string,
  from: string,
  to: string,
  check: MergeCheck,
): MergeInteraction {
  return {
    kind: 'merge',
    id,
    from,
    to,
    files: check.stats.files - check.skaroChanges.length,
    added: check.stats.added,
    removed: check.stats.removed,
    blockers: check.blockers,
    baseAhead: check.baseAhead,
    skaroChanges: check.skaroChanges,
    conflicts: check.conflicts,
  };
}

/** What the agent learns from merge_task. */
function mergeToolReply(card: MergeInteraction): string {
  const lines: string[] = [];
  if (!card.blockers.length) {
    lines.push(
      `Skaro showed the user a card to merge ${card.from} into ${card.to} ` +
        `(${card.files} files, +${card.added} −${card.removed}). The merge happens after the user ` +
        'confirms it. End your turn now; do not merge yourself.',
    );
  } else {
    lines.push(`The merge of ${card.from} into ${card.to} is blocked:`);
    for (const blocker of card.blockers) {
      if (blocker === 'dirty_base')
        lines.push(
          '- the main working copy has uncommitted changes (the user must commit or stash them);',
        );
      if (blocker === 'not_on_base')
        lines.push(`- the main working copy is not on ${card.to} (the user must switch to it);`);
      if (blocker === 'no_changes') lines.push('- the task branch has no code changes;');
      if (blocker === 'conflicts')
        lines.push(`- merge conflicts in: ${card.conflicts.join(', ')};`);
    }
    lines.push('The user sees this in a card. Tell the user briefly and end your turn.');
  }
  if (card.baseAhead) {
    lines.push(`Note: ${card.to} has ${card.baseAhead} commits the task branch does not have.`);
  }
  if (card.skaroChanges.length) {
    lines.push(
      'Changes to .skaro/ in the branch will be dropped: .skaro/ is changed only by Skaro.',
    );
  }
  return lines.join('\n');
}

/** The last agent reply of the run: the fallback task summary. */
function lastAgentText(active: ActiveRun): string | undefined {
  const items = active.timeline.state.items;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === 'message' && item.role === 'agent' && !item.parentId && item.text.trim()) {
      return item.text.trim();
    }
  }
  return undefined;
}

/** Secret answers (keys, passwords) never reach the log. */
function withoutSecrets(interaction: Interaction, answer: InteractionAnswer): InteractionAnswer {
  if (interaction.kind !== 'question' || answer.kind !== 'question') return answer;
  const secret = new Set(interaction.questions.filter((q) => q.secret).map((q) => q.id));
  if (!secret.size) return answer;
  return {
    kind: 'question',
    answers: Object.fromEntries(
      Object.entries(answer.answers).map(([id, values]) => [id, secret.has(id) ? ['•••'] : values]),
    ),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
