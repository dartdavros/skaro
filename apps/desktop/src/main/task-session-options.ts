import { isRunLogMeta, runEvent, segmentTurns, type SessionOptions } from '@skaro/timeline';
import type { ProjectArtifacts } from '@skaro/core';
import type { AgentSettings } from '../shared/ipc';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { findTask } from './task-run-helpers';
import { taskInstructions } from './prompt';
import { acceptanceInstructions } from './prompt-acceptance';
import { subjectStage } from './task-subject';
import { checkoutKey, stageIdOf } from './task-stage';
import { handoffRecord } from './task-handoff-record';
import { taskRunDirectory } from './task-run-directory';
import { taskBrowserServer } from './task-browser';

export type TaskSessionSettings = Pick<
  AgentSettings,
  'model' | 'effort' | 'permissionMode' | 'planFirst' | 'budgetUsd'
>;

/** Common task instructions, environment and history sinks; never chooses an agent or grants a tool. */
export async function taskSessionOptions(
  ctx: TaskRunEngine,
  active: ActiveRun,
  artifacts: ProjectArtifacts,
  settings: TaskSessionSettings,
  segment: number,
): Promise<SessionOptions> {
  const { projectId, taskId, run } = active;
  const context = ctx.project(projectId);
  const cwd = taskRunDirectory(context.root, run);
  const task = findTask(artifacts, taskId);
  const handoff = handoffRecord(run);
  const inWorktree = run.worktree !== undefined;
  const environment = inWorktree
    ? await ctx.environments.describe(checkoutKey(active)).catch(() => undefined)
    : undefined;
  const acceptance = subjectStage(artifacts, taskId);
  const stageId = stageIdOf(run);
  const stage = stageId ? artifacts.milestones.find((m) => m.id === stageId) : undefined;
  return {
    cwd,
    processStarted: (pid, identity) => ctx.processes.started(run.id, pid, false, identity),
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
    ...(settings.budgetUsd !== undefined ? { budgetUsd: settings.budgetUsd } : {}),
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
            locale: ctx.deps.locale(),
            managedEnvironment: environment?.config !== undefined,
          })
        : taskInstructions({
            task,
            artifacts,
            root: context.root,
            cwd,
            ...(inWorktree && run.branch ? { branch: run.branch } : {}),
            ...(inWorktree && stage ? { stage } : {}),
            locale: ctx.deps.locale(),
            managedEnvironment: environment?.config !== undefined,
          })) +
      (handoff
        ? `\n\n${handoff.context}\n\nUser messages queued before handoff: ${JSON.stringify(handoff.inputs)}`
        : ''),
    ...(environment ? { env: environment.variables } : {}),
    mcpServers: {
      playwright: await taskBrowserServer(ctx.deps.dataDir, run.id),
      ...(active.grant
        ? {
            skaro: {
              type: 'http' as const,
              url: active.grant.url,
              headers: active.grant.headers,
              trusted: true,
              timeout: 30 * 60_000,
            },
          }
        : {}),
    },
    ...(run.nativeSessionId ? { resume: run.nativeSessionId } : {}),
    rawSerialized: (line) => ctx.history.writeLine(active, line),
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
      ctx.history.writeLine(active, { ...line, line: meta, ts: Date.now() - run.startedAt });
    },
    context: ctx.deps.attachments.context(),
  };
}
