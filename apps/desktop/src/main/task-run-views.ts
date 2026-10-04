import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { indexTasks, type ProjectArtifacts, type RunRecord, type Task } from '@skaro/core';
import type { AgentId, AgentSettings, TaskAssignment, TaskSummary, TaskView } from '../shared/ipc';
import { toggleCriterion } from './task-body';
import { key, settingsKey, findTask, ref, runInfo, summary, detail } from './task-run-helpers';
import type { TaskRunEngine } from './task-run-engine';
import { orderedStageTasks, stageInfo } from './stage-views';
import { stageOf } from './task-stage';
import { subjectStage } from './task-subject';
import { readSubject, updateSubject } from './task-subject';

/** views: a focused part of the task-run controller. */
export class TaskRunViews {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  async list(projectId: string): Promise<TaskSummary[]> {
    const context = this.ctx.project(projectId);
    const artifacts = await context.load();
    const runtime = this.ctx.deps.db.getTaskRuntime(projectId);
    const index = indexTasks(artifacts.tasks);
    const runs = this.ctx.deps.db.listRuns(projectId);
    const awaiting = this.ctx.scheduling.awaiting(projectId);
    return Promise.all(
      artifacts.tasks.map(async (task) => {
        const run = runs.find((r) => r.taskId === task.id);
        const file = await stat(join(context.root, task.path)).catch(() => undefined);
        const updatedAt = Math.max(file?.mtimeMs ?? 0, run?.endedAt ?? run?.startedAt ?? 0);
        const state = runtime.get(task.id)?.state;
        const result = summary(task, artifacts, index, state, {
          ...this.assigned(projectId, task, run),
          updatedAt,
        });
        const waiting = task.status === 'todo' && (state === 'queued' || task.id in awaiting);
        const after = waiting && !result.waitsFor.length ? this.before(task, artifacts) : undefined;
        return after ? { ...result, after } : result;
      }),
    );
  }

  /** Another task of the stage works in their checkout: this one starts after it. */
  private waitsInStage(
    projectId: string,
    task: Task,
    artifacts: ProjectArtifacts,
    runtime: ReadonlyMap<string, { state: string }>,
  ): { after?: string } {
    const stage = task.status === 'todo' ? stageOf(task, artifacts) : undefined;
    if (!stage) return {};
    const busy = orderedStageTasks(stage, artifacts).find(
      (t) =>
        t.id !== task.id &&
        (t.status === 'in_progress' ||
          ['running', 'queued', 'waiting'].includes(runtime.get(t.id)?.state ?? '')),
    );
    const after = busy ? (this.before(task, artifacts) ?? busy.id) : undefined;
    return after ? { after } : {};
  }

  /** The unfinished task of the stage that runs before this one. */
  private before(task: Task, artifacts: ProjectArtifacts): string | undefined {
    const stage = stageOf(task, artifacts);
    if (!stage) return undefined;
    const order = orderedStageTasks(stage, artifacts);
    return order
      .slice(0, order.indexOf(task))
      .findLast((t) => t.status !== 'review' && t.status !== 'done')?.id;
  }

  assigned(
    projectId: string,
    task: Task,
    run: RunRecord | undefined,
  ): { agent?: AgentId; model?: string } {
    const saved = this.ctx.deps.db.getSetting<Partial<AgentSettings> | null>(
      settingsKey(projectId, task.id),
      null,
    );
    const agent = saved?.agent ?? run?.agent ?? task.agent;
    if (agent !== 'claude-code' && agent !== 'codex') return {};
    const model = saved?.model ?? run?.model ?? task.model;
    return { agent, ...(model ? { model } : {}) };
  }

  async open(projectId: string, taskId: string): Promise<TaskView> {
    const artifacts = await this.ctx.project(projectId).load();
    const task = findTask(artifacts, taskId);
    const active =
      this.ctx.active.get(key(projectId, taskId)) ??
      (await this.ctx.history.restore(projectId, taskId));
    if (active) {
      if (task.status === 'done') this.ctx.results.closeMergeCard(active, 'answered');
      else this.ctx.merges.watch(active);
    }
    const runtime = this.ctx.deps.db.getTaskRuntime(projectId);
    const settings = this.settings(projectId, task, artifacts);
    const sandbox = this.ctx.deps.db.getSetting<{ holds?: boolean } | null>(
      `agents.${settings.agent}.sandbox`,
      null,
    );
    const stage = subjectStage(artifacts, taskId);
    const index = indexTasks(artifacts.tasks);
    return {
      projectId,
      task: detail(task, artifacts, runtime),
      ...(stage
        ? {
            stage: {
              info: stageInfo(stage, artifacts, runtime, {
                awaiting: new Set(Object.keys(this.ctx.scheduling.awaiting(projectId))),
                accepted: this.ctx.deps.db.listRuns(projectId, stage.id).length > 0,
              }),
              tasks: orderedStageTasks(stage, artifacts).map((t) =>
                ref(t, index, runtime.get(t.id)?.state),
              ),
            },
          }
        : {}),
      settings,
      ...(active ? { run: runInfo(active), timeline: active.timeline.state } : {}),
      seq: active?.seq ?? 0,
      ...this.waitsInStage(projectId, task, artifacts, runtime),
      queued: this.ctx.queue.state().queued.includes(key(projectId, taskId)),
      slotsFree: this.ctx.queue.state().running.length < this.ctx.queue.state().slots,
      ...(sandbox?.holds !== undefined ? { sandboxHolds: sandbox.holds } : {}),
    };
  }

  workdir(projectId: string, taskId: string): string {
    const worktree = this.ctx.active.get(key(projectId, taskId))?.run.worktree;
    return worktree && existsSync(worktree) ? worktree : this.ctx.project(projectId).root;
  }

  settings(projectId: string, task: Task, artifacts: ProjectArtifacts): AgentSettings {
    const saved = this.ctx.deps.db.getSetting<Partial<AgentSettings> | null>(
      settingsKey(projectId, task.id),
      null,
    );
    const configured = (saved?.agent ?? task.agent ?? artifacts.config.defaultAgent) as AgentId;
    // A started task keeps its agent; a new one goes to a ready agent if its own is absent.
    const started = this.ctx.active.has(key(projectId, task.id));
    const agent =
      saved?.agent || started ? configured : this.ctx.deps.agents.readyAgent(configured);
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

  async assign(projectId: string, taskId: string, assignment: TaskAssignment): Promise<void> {
    if (this.ctx.active.has(key(projectId, taskId))) return;
    const artifacts = await this.ctx.project(projectId).load();
    const current = this.settings(projectId, findTask(artifacts, taskId), artifacts);
    const { model: _model, effort: _effort, ...rest } = current;
    this.ctx.deps.db.setSetting(settingsKey(projectId, taskId), {
      ...rest,
      agent: assignment.agent,
      ...(assignment.model ? { model: assignment.model } : {}),
      ...(assignment.effort ? { effort: assignment.effort } : {}),
    });
    this.ctx.changed(projectId, taskId);
  }

  async toggleCriterion(projectId: string, taskId: string, index: number): Promise<void> {
    const context = this.ctx.project(projectId);
    const task = await readSubject(context, taskId);
    await updateSubject(context, taskId, { body: toggleCriterion(task.body, index) });
    this.ctx.changed(projectId, taskId);
    await this.ctx.results.criteriaChanged(projectId, taskId);
  }

  async setSettings(projectId: string, taskId: string, next: AgentSettings): Promise<void> {
    const artifacts = await this.ctx.project(projectId).load();
    const task = findTask(artifacts, taskId);
    const before = this.settings(projectId, task, artifacts);
    const active = this.ctx.active.get(key(projectId, taskId));
    if (active && next.agent !== active.run.agent) {
      throw new Error('The agent of a started task cannot be changed');
    }
    const session = active?.session;
    if (session) {
      if (next.model && (next.model !== before.model || next.effort !== before.effort)) {
        await session.setModel(next.model, next.effort);
      }
      if (next.permissionMode !== before.permissionMode) {
        await session.setPermissionMode(next.permissionMode);
      }
    }
    this.ctx.deps.db.setSetting(settingsKey(projectId, taskId), next);
    this.ctx.changed(projectId, taskId);
  }

  async withDefaults(agent: AgentId, cwd: string, settings: AgentSettings): Promise<AgentSettings> {
    // Defaults from Settings → Agents come first, then the agent's own default.
    const preset = this.ctx.deps.agents.defaults(agent);
    if (!settings.model && preset.model) {
      settings = {
        ...settings,
        model: preset.model,
        ...(preset.effort && !settings.effort ? { effort: preset.effort } : {}),
      };
    }
    if (settings.model && settings.effort) return settings;
    const models = await this.ctx.deps.agents.listModels(agent, cwd).catch(() => []);
    const model =
      models.find((m) => m.id === settings.model) ?? models.find((m) => m.isDefault) ?? models[0];
    if (!model) return settings;
    const effort =
      settings.effort ??
      model.defaultEffort ??
      (model.efforts.some((e) => e.id === 'medium') ? 'medium' : model.efforts[0]?.id);
    return { ...settings, model: model.id, ...(effort ? { effort } : {}) };
  }

  async ensureAgent(agent: AgentId): Promise<void> {
    await this.ctx.deps.agents.requireReady(agent);
  }
}
