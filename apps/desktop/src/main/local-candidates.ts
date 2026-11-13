import { git, waitReady, expand, labelsOf, COMPOSE_PROJECT } from '@skaro/core';
import { readCompose } from './task-compose';
import { systemDocker } from './task-environment-docker';
import { persistentComposeData, localServiceImages } from './local-data-contract';
import type { TaskRunEngine } from './task-run-engine';
import {
  IntegrationPending,
  integrationEnvironmentKey,
  type IntegrationOperation,
} from './integration-model';
import { taskInputSnapshot, verifyPrerequisites } from './task-preflight-inputs';
import { memoryVersion } from './project-memory-sources';
import { preparedDependencies } from './completion-dependencies';

export interface LocalCandidateManifest {
  id: string;
  projectId: string;
  taskId: string;
  integrationId: string;
  head: string;
  tree: string;
  inputs: string;
  environment: string;
  checks: string;
  dataVersion: string;
  images: Record<string, string>;
  verifiedAt: number;
  health: { urls: Record<string, string>; checkedAt: number };
}

/** Uses the same integration checkout, checks and environment; never publishes to base. */
export class LocalCandidates {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  async prepare(projectId: string, taskId: string, expectedHead: string, expectedInputs: string) {
    const context = this.ctx.project(projectId);
    const artifacts = await context.store.load();
    const snapshot = await taskInputSnapshot(this.ctx.deps.db, context, artifacts, taskId);
    if (snapshot.version !== expectedInputs) throw new Error('Candidate inputs changed');
    const run = this.ctx.deps.db.listRuns(projectId, taskId)[0];
    if (!run || !run.worktree)
      throw new Error('Local candidate requires the registered task checkout');
    if (
      (await context.git.head('HEAD', run.worktree)) !== expectedHead ||
      (await git(run.worktree, ['status', '--porcelain'])).stdout.trim()
    )
      throw new Error('Commit task changes before creating an immutable local candidate');
    if (!artifacts.config.checks.length)
      throw new Error('Candidate requires real configured checks');
    try {
      const op = await this.ctx.integrations.service.prepare({
        projectId,
        taskId,
        purpose: 'local',
        inputVersion: snapshot.version,
        base: expectedHead,
        results: preparedDependencies(this.ctx.deps.db, projectId, taskId),
        checks: artifacts.config.checks,
      });
      // Recover a ready record interrupted before its additional evidence became durable.
      if (op.state === 'ready' && !this.manifest(op)) {
        op.state = 'verifying';
        op.verification = undefined;
        this.ctx.integrations.service.save(op);
        this.ctx.integrations.enqueue(op);
      }
      return op;
    } catch (error) {
      if (error instanceof IntegrationPending) return error.operation;
      throw error;
    }
  }

  async verify(projectId: string, integrationId: string): Promise<LocalCandidateManifest> {
    const op = this.ctx.integrations.store.find(projectId, integrationId);
    if (!op || op.purpose !== 'local' || op.publish || op.state !== 'ready')
      throw new Error('Local candidate is not verified');
    await this.ctx.integrations.service.assertReady(op);
    await this.requireInputs(op);
    const manifest = this.manifest(op);
    if (!manifest || manifest.head !== op.verification?.head)
      throw new Error('Candidate has no verified environment manifest');
    return manifest;
  }

  private manifest(op: IntegrationOperation): LocalCandidateManifest | undefined {
    const manifest = this.ctx.deps.db.collections.get<LocalCandidateManifest>(
      `coordination.candidates.${op.projectId}`,
      memoryVersion([op.id, op.head, op.inputVersion]),
    );
    return manifest?.dataVersion && manifest.images ? manifest : undefined;
  }

  async requireInputs(op: IntegrationOperation) {
    const context = this.ctx.project(op.projectId);
    const artifacts = await context.store.load();
    const inputs = await taskInputSnapshot(this.ctx.deps.db, context, artifacts, op.taskId);
    if (
      !op.inputVersion ||
      op.inputVersion !== inputs.version ||
      memoryVersion(op.checks) !== inputs.checks
    )
      throw new Error('Local candidate inputs changed; prepare a new candidate');
    return inputs;
  }

  /** Called by the existing executor only after checks and real service readiness on this head. */
  async record(op: IntegrationOperation): Promise<void> {
    const inputs = await this.requireInputs(op);
    await verifyPrerequisites(
      await this.ctx.project(op.projectId).store.load(),
      op.taskId,
      op.worktree,
      'result',
    );
    const description = await this.ctx.environments.describe(integrationEnvironmentKey(op));
    if (!description.config?.ready || op.verification?.head !== op.head)
      throw new Error('Local candidate requires real checks and declared readiness');
    await waitReady(expand(description.config.ready, description.identity), { timeoutMs: 10000 });
    if (!description.compose)
      throw new Error('Local installation requires a declared Compose contour');
    const model = await readCompose(description.identity.worktree, description.compose.variables);
    const dataVersion =
      description.config.env.SKARO_DATA_VERSION ??
      (persistentComposeData(model).length ? undefined : 'no-persistent-data');
    if (!dataVersion)
      throw new Error(
        'Candidate with persistent data requires an explicit SKARO_DATA_VERSION contract',
      );
    const images = localServiceImages(
      (await systemDocker.inspect()).filter(
        (c) => labelsOf(c)[COMPOSE_PROJECT] === description.identity.name,
      ),
    );
    const manifest: LocalCandidateManifest = {
      id: memoryVersion([op.id, op.head, inputs.version]),
      projectId: op.projectId,
      taskId: op.taskId,
      integrationId: op.id,
      head: op.head,
      tree: (await git(op.worktree, ['rev-parse', 'HEAD^{tree}'])).stdout.trim(),
      inputs: inputs.version,
      environment: inputs.environment,
      checks: inputs.checks,
      dataVersion,
      images,
      verifiedAt: op.verification.completedAt,
      health: {
        urls: Object.fromEntries(
          Object.entries(description.config.urls).map(([name, url]) => [
            name,
            expand(url, description.identity),
          ]),
        ),
        checkedAt: Date.now(),
      },
    };
    this.ctx.deps.db.collections.put(`coordination.candidates.${op.projectId}`, manifest);
  }
}
