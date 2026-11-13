import {
  expand,
  incidentHash,
  type CoordinationBlocker,
  type IncidentSubscription,
  type RemedyAction,
} from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { taskInputSnapshot, verifyPrerequisites } from './task-preflight-inputs';
import { TaskExecution } from './task-execution';
import { checkIncidentProvider } from './incident-provider-check';

export async function currentIncidentSubscriber(
  ctx: TaskRunEngine,
  projectId: string,
  s: IncidentSubscription,
): Promise<boolean> {
  const run = ctx.deps.db.listRuns(projectId, s.taskId)[0];
  const execution = new TaskExecution(ctx.deps.db, s.runId);
  if (
    !run ||
    run.id !== s.runId ||
    !execution.read().enabled ||
    execution.intentVersion() !== s.intent
  )
    return false;
  try {
    const context = ctx.project(projectId);
    const inputs = await taskInputSnapshot(
      ctx.deps.db,
      context,
      await context.store.load(),
      s.taskId,
    );
    return (
      inputs.version === s.inputs &&
      execution.read().enabled &&
      execution.intentVersion() === s.intent &&
      ctx.deps.db.listRuns(projectId, s.taskId)[0]?.id === s.runId
    );
  } catch {
    return false;
  }
}

export async function incidentResourceVersion(
  ctx: TaskRunEngine,
  projectId: string,
  target: string,
): Promise<string> {
  const resource = ctx.deps.db.resources.get(target);
  if (resource) {
    if (resource.projectId !== projectId)
      throw new Error('Incident resource is outside registered scope');
    const context = ctx.project(projectId);
    const { taskEnvironmentVersion } = await import('./task-environment-version');
    const ownerRun =
      resource.owner.kind === 'task'
        ? ctx.deps.db.listRuns(projectId, resource.owner.id)[0]
        : undefined;
    const { GitService } = await import('@skaro/core');
    const head = ownerRun?.worktree ? await new GitService(ownerRun.worktree).head() : undefined;
    const taskConfig =
      resource.kind === 'environment' && resource.owner.kind === 'task'
        ? (await ctx.environments.describe({ projectId, taskId: resource.owner.id })).config
        : undefined;
    return incidentHash([
      resource.id,
      resource.generation,
      resource.identity,
      head,
      taskConfig,
      await taskEnvironmentVersion(context.root, (await context.store.load()).config.environment),
    ]);
  }
  const run = ctx.deps.db.listRuns(projectId).find((r) => r.id === target);
  if (!run) throw new Error('Incident target does not belong to project');
  return incidentHash([
    run.id,
    run.agent,
    run.nativeSessionId,
    ctx.deps.agents.list().find((a) => a.id === run.agent)?.account,
  ]);
}
export async function incidentAction(
  ctx: TaskRunEngine,
  row: CoordinationBlocker,
): Promise<RemedyAction | undefined> {
  const protocol = row.protocol!;
  if (!['environment-ready', 'inputs-current'].includes(protocol.condition)) return undefined;
  if (protocol.condition === 'environment-ready') {
    const resource = ctx.deps.db.resources.get(row.subject.id);
    if (
      !resource ||
      resource.kind !== 'environment' ||
      resource.owner.kind !== 'task' ||
      resource.ownership !== 'registered'
    )
      return undefined;
  }
  if (
    (await incidentResourceVersion(ctx, row.projectId, row.subject.id)) !== protocol.resourceVersion
  )
    throw new Error('Incident resource version changed');
  return {
    projectId: row.projectId,
    incidentId: row.id,
    kind: protocol.condition === 'environment-ready' ? 'environment.start' : 'inputs.recheck',
    target: row.subject.id,
    version: protocol.resourceVersion,
    costUsd: 0,
  };
}
export async function checkIncident(
  ctx: TaskRunEngine,
  row: CoordinationBlocker,
): Promise<boolean> {
  if (row.subject.kind === 'task' || row.protocol!.condition === 'owner-evidence') return false;
  if (
    (await incidentResourceVersion(ctx, row.projectId, row.subject.id)) !==
    row.protocol!.resourceVersion
  )
    return false;
  if (row.protocol!.condition === 'provider-evidence') return checkIncidentProvider(ctx, row);
  if (row.protocol!.condition === 'environment-ready') {
    const resource = ctx.deps.db.resources.get(row.subject.id);
    if (
      !resource ||
      resource.kind !== 'environment' ||
      resource.owner.kind !== 'task' ||
      resource.ownership !== 'registered'
    )
      return false;
    const description = await ctx.environments.describe({
      projectId: row.projectId,
      taskId: resource.owner.id,
    });
    if (!description.config?.ready) return false;
    try {
      const response = await fetch(expand(description.config.ready, description.identity), {
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  }
  if (row.protocol!.condition === 'inputs-current') {
    for (const s of row.protocol!.subscriptions) {
      if (!(await currentIncidentSubscriber(ctx, row.projectId, s))) continue;
      const context = ctx.project(row.projectId);
      const run = ctx.deps.db.listRuns(row.projectId, s.taskId)[0]!;
      try {
        await verifyPrerequisites(
          await context.store.load(),
          s.taskId,
          run.worktree ?? context.root,
        );
      } catch {
        return false;
      }
    }
    return true;
  }
  // Quota reset timers and owner/model prose are not fresh provider or artifact evidence.
  return false;
}
