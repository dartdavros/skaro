// Task runs (architecture.md 7–8, D-27): a worktree and an agent session per task, the raw log as
// the source of truth, the timeline kept here and streamed to the renderer, statuses, and the
// merge confirmed in the task chat.

import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  displayStatus,
  indexTasks,
  isBlocked,
  MergeBlockedError,
  pendingDependencies,
  startBlocker,
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
  type WorktreeSnapshot,
} from '@skaro/core';
import type {
  Grant,
  McpHttpServer,
  MergeTaskArgs,
  SubmitResultArgs,
  SkaroScope,
  ToolResult,
} from '@skaro/mcp-server';
import {
  isRunLogMeta,
  countSegments,
  replayRunLog,
  segmentTurns,
  Timeline,
  type AgentSession,
  type Interaction,
  type InteractionAnswer,
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
  RunSlots,
  TaskAssignment,
  TaskDetail,
  TaskRef,
  TaskSummary,
  TaskView,
} from '../shared/ipc';
import { AUTO_MERGE_KEY } from '../shared/ipc';
import type { AgentManager } from './agents';
import type { ProjectContext, Projects } from './projects';
import type { NotifyKind } from './notifier';
import { taskInstructions } from './prompt';
import { errorText, projectorFor, readRunLog, withoutSecrets } from './session-log';
import { setCriteria, taskSections, toggleCriterion, withSummary } from './task-body';

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
  /** A system notification ("Настройки" → "Уведомления"). */
  notify?: (kind: NotifyKind, text: string) => void;
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
  /** Agent processes the run log holds so far ("segment" lines); turns are numbered per segment. */
  segments = 0;
  flushTimer: NodeJS.Timeout | undefined;
  /** Resolves the queue slot when the first turn ends. */
  release: (() => void) | undefined;
  /** Summary the agent gave to merge_task. */
  mergeSummary: string | undefined;
  /** Commit message the agent proposed for the merge (submit_result, merge_task). */
  commitMessage: string | undefined;
  /** The automatic merge that just happened (the agent is told about it). */
  merged: { commit: string; base: string } | undefined;
  /** Serializes session start and resume. */
  attaching: Promise<AgentSession> | undefined;
  /** Worktree snapshots taken before sending, waiting for their user message to show up. */
  pendingSnapshots: WorktreeSnapshot[] = [];
  /** User message id → worktree state before it (rewind puts the files back). */
  readonly snapshots = new Map<string, WorktreeSnapshot>();
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
    const context = this.project(projectId);
    const artifacts = await context.load();
    const runtime = this.deps.db.getTaskRuntime(projectId);
    const index = indexTasks(artifacts.tasks);
    const runs = this.deps.db.listRuns(projectId);
    return Promise.all(
      artifacts.tasks.map(async (task) => {
        const run = runs.find((r) => r.taskId === task.id);
        const file = await stat(join(context.root, task.path)).catch(() => undefined);
        const updatedAt = Math.max(file?.mtimeMs ?? 0, run?.endedAt ?? run?.startedAt ?? 0);
        return summary(task, artifacts, index, runtime.get(task.id)?.state, {
          ...this.assigned(projectId, task, run),
          updatedAt,
        });
      }),
    );
  }

  /** The agent a task is given to: the saved choice, its last run, else the task file. */
  private assigned(
    projectId: string,
    task: Task,
    run: RunRecord | undefined,
  ): { agent?: AgentId; model?: string } {
    const saved = this.deps.db.getSetting<Partial<AgentSettings> | null>(
      settingsKey(projectId, task.id),
      null,
    );
    const agent = saved?.agent ?? run?.agent ?? task.agent;
    if (agent !== 'claude-code' && agent !== 'codex') return {};
    const model = saved?.model ?? run?.model ?? task.model;
    return { agent, ...(model ? { model } : {}) };
  }

  // ── task board (Tasks mockup) ────────────────────────────────────────────

  slots(): RunSlots {
    const { slots, running } = this.queue.state();
    return { total: slots, free: Math.max(0, slots - running.length) };
  }

  setSlots(slots: number): void {
    this.queue.setSlots(slots);
  }

  /** Mass launch: runnable tasks start or wait for a slot, in the given order. */
  async launch(
    projectId: string,
    taskIds: string[],
    message: string,
    assignment?: TaskAssignment,
  ): Promise<void> {
    const artifacts = await this.project(projectId).load();
    const index = indexTasks(artifacts.tasks);
    const awaiting = this.awaiting(projectId);
    for (const id of taskIds) {
      const task = findTask(artifacts, id);
      const blocker = startBlocker(task, index);
      // A blocked task starts on its own once its dependencies are merged.
      if (blocker === 'blocked') awaiting[id] = { message, ...(assignment ? { assignment } : {}) };
      if (this.active.has(key(projectId, id)) || blocker) continue;
      if (assignment) await this.assign(projectId, id, assignment);
      await this.send(projectId, id, { text: message });
    }
    this.deps.db.setSetting(awaitingKey(projectId), awaiting);
  }

  /** Blocked tasks of a mass launch, waiting for their dependencies to be merged. */
  private awaiting(
    projectId: string,
  ): Record<string, { message: string; assignment?: TaskAssignment }> {
    return this.deps.db.getSetting(awaitingKey(projectId), {}) ?? {};
  }

  /** After a merge: tasks it unblocked that were launched while blocked start now. */
  private async launchUnblocked(projectId: string, unblocked: string[]): Promise<void> {
    const awaiting = this.awaiting(projectId);
    const ready = unblocked.filter((id) => awaiting[id]);
    if (!ready.length) return;
    for (const id of ready) {
      const { message, assignment } = awaiting[id]!;
      delete awaiting[id];
      this.deps.db.setSetting(awaitingKey(projectId), awaiting);
      await this.launch(projectId, [id], message, assignment).catch(() => undefined);
    }
  }

  /** "Назначить агента": the agent, model and effort the task starts with. */
  async assign(projectId: string, taskId: string, assignment: TaskAssignment): Promise<void> {
    if (this.active.has(key(projectId, taskId))) return;
    const artifacts = await this.project(projectId).load();
    const current = this.settings(projectId, findTask(artifacts, taskId), artifacts);
    const { model: _model, effort: _effort, ...rest } = current;
    this.deps.db.setSetting(settingsKey(projectId, taskId), {
      ...rest,
      agent: assignment.agent,
      ...(assignment.model ? { model: assignment.model } : {}),
      ...(assignment.effort ? { effort: assignment.effort } : {}),
    });
    this.changed(projectId, taskId);
  }

  /** Before a task is deleted: its run stops, its worktrees and branches go away. */
  async forget(projectId: string, taskId: string): Promise<void> {
    const k = key(projectId, taskId);
    this.queue.cancel(k);
    this.firstInputs.delete(k);
    const active = this.active.get(k);
    if (active) {
      await this.detach(active);
      active.log?.end();
      this.active.delete(k);
    }
    const git = this.project(projectId).git;
    for (const run of this.deps.db.listRuns(projectId, taskId)) {
      if (!run.endedAt) this.deps.db.finishRun(run.id, 'interrupted');
      if (run.worktree) await git.removeWorktree(run.worktree);
      if (run.branch) await git.deleteBranch(run.branch);
    }
    this.deps.db.setSetting(settingsKey(projectId, taskId), null);
    this.setRuntime(projectId, taskId, 'idle');
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
    await this.criteriaChanged(projectId, taskId);
  }

  // ── settings ─────────────────────────────────────────────────────────────

  settings(projectId: string, task: Task, artifacts: ProjectArtifacts): AgentSettings {
    const saved = this.deps.db.getSetting<Partial<AgentSettings> | null>(
      settingsKey(projectId, task.id),
      null,
    );
    const configured = (saved?.agent ?? task.agent ?? artifacts.config.defaultAgent) as AgentId;
    // A started task keeps its agent; a new one goes to a ready agent if its own is absent.
    const started = this.active.has(key(projectId, task.id));
    const agent = saved?.agent || started ? configured : this.deps.agents.readyAgent(configured);
    const model = saved?.model ?? task.model ?? artifacts.config.defaultModel;
    // The project's default effort goes with the project's default model.
    const effort =
      saved?.effort ??
      (model && model === artifacts.config.defaultModel
        ? artifacts.config.defaultEffort
        : undefined);
    return {
      agent: agent === 'codex' ? 'codex' : 'claude-code',
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      permissionMode: saved?.permissionMode ?? artifacts.config.permissionMode,
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
    await this.deliver(active, input);
  }

  /** Sends a message to the run's agent; the worktree is snapshotted first (rewind). */
  private async deliver(active: ActiveRun, input: MessageInput): Promise<void> {
    const session = await this.attach(active);
    await this.snapshotBeforeMessage(active);
    if (active.timeline.state.status === 'idle') await session.send(input);
    else await session.steer(input);
  }

  private async snapshotBeforeMessage(active: ActiveRun): Promise<void> {
    const worktree = active.run.worktree;
    if (!worktree || !existsSync(worktree)) return;
    try {
      active.pendingSnapshots.push(await this.project(active.projectId).git.snapshot(worktree));
    } catch {
      // No snapshot: rewinding to this message takes back the conversation only.
    }
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
    // Codex takes back only the conversation; the files come back from Skaro's snapshot.
    const snapshot = active.snapshots.get(itemId);
    const worktree = active.run.worktree;
    if (snapshot && worktree && existsSync(worktree)) {
      await this.project(projectId).git.restoreSnapshot(worktree, snapshot);
    }
    if (resend) await this.deliver(active, resend);
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
    // A task is merged only when every acceptance criterion is ticked (submit_result or the user).
    const open = taskSections(task.body).criteria.flatMap((c, i) => (c.done ? [] : [i + 1]));
    if (open.length) return { text: unmetReply(task, open, 'merge'), isError: true };
    if (args.summary) active.mergeSummary = args.summary;
    if (args.commitMessage) active.commitMessage = args.commitMessage;
    const interaction = await this.showMergeCard(active, context, artifacts, task);
    return { text: mergeToolReply(interaction) };
  }

  /** Commits leftovers in the worktree, checks the merge and (re)opens the merge card. */
  private async showMergeCard(
    active: ActiveRun,
    context: ProjectContext,
    artifacts: ProjectArtifacts,
    task: Task,
  ): Promise<MergeInteraction> {
    const worktree = active.run.worktree!;
    const branch = active.run.branch!;
    await context.git.commitAll(worktree, `${task.id}: ${task.title}`);
    const check = await context.git.checkMerge(artifacts.config.baseBranch, branch);
    this.closeMergeCard(active);
    const interaction = mergeInteraction(randomUUID(), branch, artifacts.config.baseBranch, check);
    if (active.commitMessage) interaction.message = active.commitMessage;
    this.skaroEvent(active, { t: 'interaction.opened', interaction });
    this.settleRuntime(active);
    return interaction;
  }

  private closeMergeCard(active: ActiveRun): void {
    const open = active.timeline.state.interactions.find((i) => i.kind === 'merge');
    if (open)
      this.skaroEvent(active, { t: 'interaction.closed', id: open.id, resolution: 'cancelled' });
  }

  /**
   * Criteria were ticked or unticked (submit_result, the user). All ticked: "На ревью" and the
   * merge card, so the user merges with one click; in the main working copy there is nothing to
   * merge and the task is done. Not all: the task is back in work and the card goes away.
   */
  private async criteriaChanged(
    projectId: string,
    taskId: string,
  ): Promise<'merge' | 'merged' | 'done' | 'open' | 'none'> {
    const context = this.project(projectId);
    context.invalidate();
    const artifacts = await context.load();
    const task = findTask(artifacts, taskId);
    const criteria = taskSections(task.body).criteria;
    const active =
      this.active.get(key(projectId, taskId)) ?? (await this.restore(projectId, taskId));
    if (!criteria.length || !active || task.status === 'done') return 'none';

    if (!criteria.every((c) => c.done)) {
      if (task.status === 'review')
        await context.store.updateTask(taskId, { status: 'in_progress' });
      this.closeMergeCard(active);
      this.settleRuntime(active);
      this.statusChanged(projectId, taskId);
      return 'open';
    }

    if (!active.run.worktree || !active.run.branch) {
      const before = artifacts.tasks;
      await context.store.updateTask(taskId, { status: 'done' });
      context.invalidate();
      const after = (await context.load()).tasks;
      this.statusChanged(projectId, taskId);
      const unblocked = newlyUnblocked(before, after);
      for (const id of unblocked) this.changed(projectId, id);
      void this.launchUnblocked(projectId, unblocked);
      return 'done';
    }

    // "Вливать автоматически": commit and merge now; a blocked merge falls back to the card.
    if (this.deps.db.getSetting<boolean | null>(AUTO_MERGE_KEY, null) === true) {
      const card = active.timeline.state.interactions.find(
        (i): i is MergeInteraction => i.kind === 'merge',
      );
      try {
        active.merged = await this.confirmMerge(active, context, card, active.commitMessage ?? '');
        return 'merged';
      } catch (error) {
        if (!(error instanceof MergeBlockedError))
          this.notice(active, 'other', 'error', errorText(error));
        context.invalidate();
      }
    }

    if (task.status !== 'review') {
      await context.store.updateTask(taskId, { status: 'review' });
      this.deps.db.addEvent(projectId, 'task_review', { task: taskId });
      this.deps.notify?.('review', `${task.id} · ${task.title}`);
    }
    // A card is shown once; a new commit message from the agent refreshes it.
    const card = active.timeline.state.interactions.find(
      (i): i is MergeInteraction => i.kind === 'merge',
    );
    if (!card || (active.commitMessage && card.message !== active.commitMessage)) {
      await this.showMergeCard(active, context, artifacts, task);
    }
    this.statusChanged(projectId, taskId);
    return 'merge';
  }

  private statusChanged(projectId: string, taskId: string): void {
    this.project(projectId).invalidate();
    this.changed(projectId, taskId);
    this.deps.emit('project.changed', { projectId });
  }

  /** `submit_result`: the agent's verdict on each criterion; Skaro ticks the task from it. */
  async submitResult(args: SubmitResultArgs, scope: SkaroScope): Promise<ToolResult> {
    if (!scope.taskId)
      return { text: 'submit_result works only in a task session.', isError: true };
    const active = this.active.get(key(scope.projectId, scope.taskId));
    if (!active || active.run.id !== scope.runId) {
      return { text: 'This session is no longer the current run of the task.', isError: true };
    }
    const context = this.project(active.projectId);
    const task = await context.store.readTask(active.taskId);
    const criteria = taskSections(task.body).criteria;
    const verdicts = new Map(args.criteria.map((v) => [v.number, v]));
    const wrong = [...verdicts.keys()].filter((n) => n > criteria.length);
    const missing = criteria.map((_, i) => i + 1).filter((n) => !verdicts.has(n));
    if (wrong.length || missing.length) {
      return {
        text:
          `The task has ${criteria.length} acceptance criteria, numbered 1–${criteria.length}. ` +
          (missing.length ? `No verdict for: ${missing.join(', ')}. ` : '') +
          (wrong.length ? `No such criteria: ${wrong.join(', ')}. ` : '') +
          'Give a verdict for every criterion and call submit_result again.',
        isError: true,
      };
    }
    const met = criteria.map((_, i) => verdicts.get(i + 1)!.met);
    await context.store.updateTask(task.id, { body: setCriteria(task.body, met) });
    active.mergeSummary = args.summary;
    if (args.commitMessage) active.commitMessage = args.commitMessage;
    const state = await this.criteriaChanged(active.projectId, active.taskId);
    const open = met.flatMap((ok, i) => (ok ? [] : [i + 1]));
    if (open.length) return { text: unmetReply(task, open, 'result') };
    const done = `All ${criteria.length} acceptance criteria are ticked in the task. `;
    if (state === 'merged' && active.merged) {
      return {
        text:
          done +
          `Skaro committed the work and merged the task branch into ${active.merged.base} ` +
          `(commit ${active.merged.commit.slice(0, 7)}): the project merges finished tasks ` +
          'automatically. Do not change files anymore. Tell the user the task is done and ' +
          'merged, with a short summary and how each criterion was checked.',
      };
    }
    return {
      text:
        state === 'merge'
          ? done +
            'Skaro showed the user a card to merge the task branch; the merge happens when the ' +
            'user confirms it. Do not call merge_task. Tell the user the task is done and ready ' +
            'to merge, with a short summary and how each criterion was checked.'
          : done +
            'Tell the user the task is done, with a short summary and how each criterion was checked.',
    };
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
        if (card.message) next.message = card.message;
        if (!result.ok) next.conflicts = result.conflicts;
        this.skaroEvent(active, { t: 'interaction.opened', interaction: next });
        return;
      }
      case 'resolve_with_agent': {
        this.skaroEvent(active, { t: 'interaction.closed', id: card.id, resolution: 'cancelled' });
        const files = card.conflicts.map((f) => `- ${f}`).join('\n');
        await this.deliver(active, {
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

  /** The merge itself: after "Влить" on the card, or on its own when the project merges automatically. */
  private async confirmMerge(
    active: ActiveRun,
    context: ProjectContext,
    card: MergeInteraction | undefined,
    message: string,
  ): Promise<{ commit: string; base: string }> {
    const artifacts = await context.load();
    const task = findTask(artifacts, active.taskId);
    const base = artifacts.config.baseBranch;
    const branch = active.run.branch!;
    const summaryText = active.mergeSummary ?? lastAgentText(active);
    // Whatever the agent wrote after the card was shown goes into the merge too.
    if (active.run.worktree)
      await context.git.commitAll(active.run.worktree, `${task.id}: ${task.title}`);
    let result: { commit: string; check: MergeCheck };
    try {
      result = await context.git.merge({
        base,
        branch,
        strategy: artifacts.config.merge.strategy,
        worktree: active.run.worktree,
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
      if (card && error instanceof MergeBlockedError) {
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
    this.deps.db.addEvent(active.projectId, 'merged', { task: task.id, base });
    this.deps.notify?.('merged', `${task.id} · ${task.title}`);
    if (card)
      this.skaroEvent(active, { t: 'interaction.closed', id: card.id, resolution: 'answered' });
    const unblocked = newlyUnblocked(artifacts.tasks, after.tasks);
    this.skaroEvent(active, {
      t: 'item.upsert',
      item: {
        id: `skaro-merged-${card?.id ?? result.commit}`,
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
    void this.launchUnblocked(active.projectId, unblocked);

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
    return { commit: result.commit, base };
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
      await this.deliver(active, input);
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
    // After the merge the worktree is gone: the conversation goes on in the main working copy.
    const inWorktree = run.worktree !== undefined && existsSync(run.worktree);
    const cwd = inWorktree ? run.worktree! : context.root;

    const segment = active.segments++;
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
          root: context.root,
          cwd,
          ...(inWorktree && run.branch ? { branch: run.branch } : {}),
          locale: this.deps.locale(),
        }),
        mcpServers: {
          skaro: {
            type: 'http',
            url: active.grant.url,
            headers: active.grant.headers,
            trusted: true,
          },
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
    void this.pump(active, session, segment);
    this.changed(projectId, taskId);
    return session;
  }

  private async pump(active: ActiveRun, session: AgentSession, segment: number): Promise<void> {
    try {
      for await (const event of session.events) {
        this.onEvent(active, segmentTurns(segment, event));
      }
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
    if (
      event.t === 'item.upsert' &&
      event.item.kind === 'message' &&
      event.item.role === 'user' &&
      !event.item.parentId &&
      !active.snapshots.has(event.item.id)
    ) {
      const snapshot = active.pendingSnapshots.shift();
      if (snapshot) {
        active.snapshots.set(event.item.id, snapshot);
        this.writeLine(active, {
          ts: Date.now() - active.run.startedAt,
          dir: 'meta',
          line: { skaro: 'snapshot', itemId: event.item.id, ...snapshot },
        });
      }
    }
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
        // The merge card is "На ревью", not a question: it does not make the task wait.
        if (event.interaction.kind !== 'merge') {
          this.setRuntime(projectId, taskId, 'waiting', active.run.id);
          this.deps.db.addEvent(projectId, 'waiting', {
            task: taskId,
            what: event.interaction.kind,
            ...(event.interaction.kind === 'approval'
              ? { detail: event.interaction.action.title }
              : {}),
          });
          void this.notifyTask('need', projectId, taskId);
        }
        return;
      case 'interaction.closed':
        this.settleRuntime(active);
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
    const { projectId, taskId } = active;
    const context = this.project(projectId);
    try {
      const task = await context.store.readTask(taskId);
      if (task.status === 'done') return;
      const label = `${task.id} · ${task.title}`;
      if (outcome === 'failed') {
        if (task.status !== 'failed') {
          this.deps.db.addEvent(projectId, 'task_failed', { task: taskId });
          await context.store.updateTask(taskId, { status: 'failed' });
          this.deps.notify?.('error', label);
          this.statusChanged(projectId, taskId);
        }
        return;
      }
      // The turn ended: "На ревью" only when every criterion is ticked, else the agent waits
      // for the user ("Нужен ответ", derived from "В работе" with no agent working).
      if (task.status === 'failed')
        await context.store.updateTask(taskId, { status: 'in_progress' });
      const state = await this.criteriaChanged(projectId, taskId);
      if (state === 'open' || state === 'none') {
        this.deps.notify?.('need', label);
        this.statusChanged(projectId, taskId);
      }
    } catch {
      // The task file is gone or broken: the feed still works.
    }
    this.changed(projectId, taskId);
  }

  /** Runtime: waiting while a question or permission is open, idle or running otherwise. */
  private settleRuntime(active: ActiveRun): void {
    const s = active.timeline.state;
    const state: TaskRuntime = s.interactions.some((i) => i.kind !== 'merge')
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
    active.segments = countSegments(lines);
    for (const line of lines) {
      if (line.dir === 'meta' && isRunLogMeta(line.line) && line.line.skaro === 'snapshot') {
        active.snapshots.set(line.line.itemId, { head: line.line.head, tree: line.line.tree });
      }
    }
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
    // Defaults from Settings → Agents come first, then the agent's own default.
    const preset = this.deps.agents.defaults(agent);
    if (!settings.model && preset.model) {
      settings = {
        ...settings,
        model: preset.model,
        ...(preset.effort && !settings.effort ? { effort: preset.effort } : {}),
      };
    }
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

  /** An absent agent is inactive: nothing starts until it is downloaded and signed in. */
  private async ensureAgent(agent: AgentId): Promise<void> {
    await this.deps.agents.requireReady(agent);
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

  private async notifyTask(kind: NotifyKind, projectId: string, taskId: string): Promise<void> {
    if (!this.deps.notify) return;
    const task = await this.project(projectId)
      .store.readTask(taskId)
      .catch(() => undefined);
    this.deps.notify(kind, task ? `${task.id} · ${task.title}` : taskId);
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

function awaitingKey(projectId: string): string {
  return `tasks.${projectId}.awaitingStart`;
}

function settingsKey(projectId: string, taskId: string): string {
  return `task.${projectId}.${taskId}.agent`;
}

function findTask(artifacts: ProjectArtifacts, taskId: string): Task {
  const task = artifacts.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`unknown task ${taskId}`);
  return task;
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
  runtime: TaskRuntime | undefined,
  extra: { agent?: AgentId; model?: string; updatedAt: number },
): TaskSummary {
  const milestone = artifacts.milestones.find((m) => m.id === task.milestone);
  const spec = task.spec ? artifacts.specs.find((s) => s.id === task.spec) : undefined;
  return {
    ...ref(task, index, runtime),
    ...(milestone ? { milestone: { id: milestone.id, title: milestone.title } } : {}),
    ...(spec ? { spec: { id: spec.id, title: spec.title, path: spec.path } } : {}),
    archived: task.archived,
    ...extra,
    deps: task.dependsOn,
    ...(task.order !== undefined ? { order: task.order } : {}),
    waitsFor: isBlocked(task, index) ? pendingDependencies(task, index) : [],
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
    ...summary(task, artifacts, index, runtime.get(task.id)?.state, { updatedAt: 0 }),
    dependsOn: task.dependsOn.map(
      (id) => (index.get(id) && refOf(index.get(id)!)) ?? { id, title: id, status: 'todo' },
    ),
    blocks: artifacts.tasks.filter((t) => t.dependsOn.includes(task.id)).map(refOf),
    ...(task.branch ? { branch: task.branch } : {}),
    ...taskSections(task.body),
    ...requirementsOf(artifacts.specs.find((s) => s.id === task.spec)?.body),
  };
}

/** "- R-2 Права проверяются на сервере" lines of a specification. */
export function requirementsOf(body: string | undefined): {
  requirements?: { id: string; text: string }[];
} {
  const list = [...(body ?? '').matchAll(/^\s*[-*]\s+(R-\d+)[\s:.—–-]+(.+)$/gm)].map((m) => ({
    id: m[1]!,
    text: m[2]!.trim(),
  }));
  return list.length ? { requirements: list } : {};
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

/** Criteria not ticked: what the agent must tell the user instead of "done". */
function unmetReply(task: Task, open: number[], after: 'result' | 'merge'): string {
  const criteria = taskSections(task.body).criteria;
  const list = open.map((n) => `${n}. ${criteria[n - 1]?.text ?? ''}`).join('\n');
  const head =
    after === 'merge'
      ? 'Skaro did not start the merge: these acceptance criteria are not ticked:'
      : 'Skaro ticked the criteria you reported as met. These are not met:';
  return (
    `${head}\n${list}\n` +
    'The task is not done. Tell the user plainly which criteria are not met and why. Finish ' +
    'them and call submit_result again, or the user ticks a criterion by hand if they accept it.'
  );
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
