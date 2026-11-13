import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { runShell, waitReady, type AppDb } from '@skaro/core';
import type { Projects } from './projects';
import type { LocalCandidateManifest } from './local-candidates';
import type { LocalVersionReceipt, LocalVersionTarget } from '../shared/local-versions';
import { inspectLocalTarget, localDataObjects, localTargetContract } from './local-version-target';
import { memoryVersion } from './project-memory-sources';
import { resourceExecution, resourcesFor } from './resource-execution';
import { systemDocker } from './task-environment-docker';
import { localVersionBudget } from './local-version-budget';
import { localServiceImages } from './local-data-contract';
import { localVersionRelease } from './local-version-release';
import { localImageVariables } from './local-version-images';

/** Owner IPC only. Durable exact-target installation, independent of task worktree and Git acceptance. */
export class LocalVersions {
  private readonly db: AppDb;
  private readonly projects: Projects;
  private readonly dataDir: string;
  private readonly candidate: (
    project: string,
    integration: string,
  ) => Promise<LocalCandidateManifest>;
  constructor(
    db: AppDb,
    projects: Projects,
    dataDir: string,
    candidate: (project: string, integration: string) => Promise<LocalCandidateManifest>,
  ) {
    this.db = db;
    this.projects = projects;
    this.dataDir = dataDir;
    this.candidate = candidate;
  }
  async register(
    projectId: string,
    input: Omit<LocalVersionTarget, 'projectId' | 'revision'>,
  ): Promise<LocalVersionTarget> {
    if (!/^[a-zA-Z0-9_-]+$/.test(input.id)) throw new Error('Invalid local target ID');
    const target: LocalVersionTarget = { ...input, projectId, revision: '' };
    const observed = await inspectLocalTarget(this.db, target);
    target.revision = memoryVersion([input, observed.configuration, observed.resource.generation]);
    target.configuration = observed.configuration;
    this.db.collections.put(`coordination.local-targets.${projectId}`, target);
    return target;
  }

  async install(
    projectId: string,
    targetId: string,
    manifestId: string,
    expectedRevision: string,
  ): Promise<LocalVersionReceipt> {
    const target = this.db.collections.get<LocalVersionTarget>(
      `coordination.local-targets.${projectId}`,
      targetId,
    );
    const manifest = this.db.collections.get<LocalCandidateManifest>(
      `coordination.candidates.${projectId}`,
      manifestId,
    );
    if (!target || target.revision !== expectedRevision || !manifest)
      throw new Error('Local installation target or manifest changed');
    if (!manifest.dataVersion || manifest.dataVersion !== target.dataVersion)
      throw new Error('Candidate and permanent target data versions are incompatible');
    const verified = await this.candidate(projectId, manifest.integrationId);
    if (memoryVersion(verified) !== memoryVersion(manifest))
      throw new Error('Candidate manifest changed');
    const unfinished = this.db.collections
      .all<LocalVersionReceipt>(`coordination.installations.${projectId}`)
      .some(
        (r) =>
          r.targetId === targetId &&
          ['prepared', 'installing', 'rollback_required'].includes(r.state),
      );
    if (unfinished)
      throw new Error('Previous local installation requires reconciliation or rollback');
    return this.exclusive(target, async () => {
      const before = await inspectLocalTarget(this.db, target);
      if (before.configuration !== target.configuration)
        throw new Error('Permanent target configuration changed; register the new exact target');
      if (
        this.db.collections.get<LocalVersionTarget>(
          `coordination.local-targets.${projectId}`,
          targetId,
        )?.revision !== expectedRevision
      )
        throw new Error('Local target changed while waiting for admission');
      if (
        memoryVersion(await this.candidate(projectId, manifest.integrationId)) !==
        memoryVersion(manifest)
      )
        throw new Error('Candidate changed while waiting for admission');
      const context = this.projects.get(projectId);
      const release = await localVersionRelease(
        this.db,
        this.dataDir,
        context,
        manifest,
        target.id,
      );
      const next = await inspectLocalTarget(this.db, target, release);
      if (next.dataFingerprint !== before.dataFingerprint)
        throw new Error('Installation would replace persistent data');
      const receipt: LocalVersionReceipt = {
        id: randomUUID(),
        targetId,
        manifestId,
        release,
        previous: target.variables[target.codeVariable] ?? before.root,
        state: 'prepared',
        head: manifest.head,
        tree: manifest.tree,
        dataVersion: target.dataVersion,
        dataFingerprint: localDataObjects(before.containers),
        checkpointCompleted: false,
        wasRunning: before.containers.some((c) => c.State?.Running),
        targetContract: localTargetContract(target),
        previousConfiguration: before.configuration,
        previousImages: localServiceImages(before.containers),
      };
      const installVariables = await localImageVariables(
        this.dataDir,
        projectId,
        receipt.id,
        'install',
        next,
        manifest.images,
      );
      this.save(projectId, receipt);
      if (target.checkpoint) {
        await this.command(target.checkpoint, before.root, before.variables);
        receipt.checkpointCompleted = true;
        this.save(projectId, receipt);
      }
      receipt.state = 'installing';
      this.save(projectId, receipt);
      try {
        await localVersionBudget(this.db, this.dataDir, target, next);
        await this.command(
          'docker compose up -d --wait --no-build --pull never',
          dirname(next.composeFile),
          installVariables,
        );
        await waitReady(target.ready, { signal: resourceExecution.getStore()?.signal });
        const after = await inspectLocalTarget(this.db, target, release);
        if (memoryVersion(localServiceImages(after.containers)) !== memoryVersion(manifest.images))
          throw new Error('Installed service image identities differ from the verified candidate');
        if (localDataObjects(after.containers) !== receipt.dataFingerprint)
          throw new Error('Persistent data identities changed');
        receipt.state = 'verified';
        this.save(projectId, receipt);
        target.variables = { ...target.variables, [target.codeVariable]: release };
        target.configuration = after.configuration;
        target.revision = memoryVersion([target.revision, receipt.id]);
        this.db.collections.put(`coordination.local-targets.${projectId}`, target);
        return receipt;
      } catch (error) {
        receipt.state = 'rollback_required';
        this.save(projectId, receipt);
        throw error;
      }
    });
  }

  async rollback(projectId: string, id: string): Promise<LocalVersionReceipt> {
    const receipt = this.db.collections.get<LocalVersionReceipt>(
      `coordination.installations.${projectId}`,
      id,
    );
    if (!receipt) throw new Error('Unknown installation receipt');
    if (receipt.state === 'rolled_back') return receipt;
    if (
      this.db.collections
        .all<LocalVersionReceipt>(`coordination.installations.${projectId}`)
        .filter((r) => r.targetId === receipt.targetId)
        .at(-1)?.id !== receipt.id
    )
      throw new Error('A newer installation owns the target; do not roll back an obsolete receipt');
    const target = this.db.collections.get<LocalVersionTarget>(
      `coordination.local-targets.${projectId}`,
      receipt.targetId,
    );
    if (!target || target.dataVersion !== receipt.dataVersion)
      throw new Error('Local target data contract changed');
    return this.exclusive(target, async () => {
      if (localTargetContract(target) !== receipt.targetContract)
        throw new Error(
          'Rollback target contract changed; reconcile before changing the environment',
        );
      const previous = await inspectLocalTarget(this.db, target, receipt.previous);
      if (
        previous.configuration !== receipt.previousConfiguration ||
        localDataObjects(previous.containers) !== receipt.dataFingerprint
      )
        throw new Error('Rollback target configuration or data identities changed');
      const rollbackVariables = await localImageVariables(
        this.dataDir,
        projectId,
        receipt.id,
        'rollback',
        previous,
        receipt.previousImages,
      );
      await systemDocker.stop(previous.containers);
      if (receipt.checkpointCompleted)
        await this.command(target.restore!, previous.root, previous.variables);
      await this.command(
        'docker compose up -d --wait --no-build --pull never',
        dirname(previous.composeFile),
        rollbackVariables,
      );
      await waitReady(target.ready, { signal: resourceExecution.getStore()?.signal });
      const after = await inspectLocalTarget(this.db, target, receipt.previous);
      if (
        memoryVersion(localServiceImages(after.containers)) !==
        memoryVersion(receipt.previousImages)
      )
        throw new Error('Rollback image identities differ');
      if (localDataObjects(after.containers) !== receipt.dataFingerprint)
        throw new Error('Rollback data identities differ');
      if (!receipt.wasRunning) await systemDocker.stop(after.containers);
      if (!receipt.wasRunning)
        resourcesFor(this.db)?.releaseOwner(
          projectId,
          `local-environment:${target.id}`,
          'persistent_target_rollback_confirmed_stopped',
        );
      target.variables = { ...target.variables, [target.codeVariable]: receipt.previous };
      target.configuration = after.configuration;
      target.revision = memoryVersion([target.revision, receipt.id, 'rolled_back']);
      this.db.collections.put(`coordination.local-targets.${projectId}`, target);
      receipt.state = 'rolled_back';
      this.save(projectId, receipt);
      return receipt;
    });
  }

  private async exclusive<T>(target: LocalVersionTarget, action: () => Promise<T>): Promise<T> {
    const resources = resourcesFor(this.db);
    if (!resources) throw new Error('Local installation requires resource dispatcher');
    const effect = async () => {
      const observed = await inspectLocalTarget(this.db, target);
      const held = await resources.acquire('build', undefined, {
        checkpoint: `local-install:${target.id}`,
        locks: [
          {
            resourceId: observed.resource.id,
            generation: observed.resource.generation,
            mode: 'exclusive',
          },
        ],
      });
      try {
        return await action();
      } finally {
        held.release('local_installation_executor_settled');
      }
    };
    return resourceExecution.getStore()
      ? effect()
      : resources.scope(target.projectId, `local:${target.id}`, effect);
  }
  private command(command: string, cwd: string, env: Record<string, string>) {
    return runShell(command, {
      cwd,
      env,
      signal: resourceExecution.getStore()?.signal,
      timeoutMs: 30 * 60_000,
    });
  }
  private save(projectId: string, receipt: LocalVersionReceipt): void {
    this.db.collections.put(`coordination.installations.${projectId}`, receipt);
  }
}
