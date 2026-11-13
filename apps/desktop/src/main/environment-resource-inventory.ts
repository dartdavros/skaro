import { realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  COMPOSE_PROJECT,
  COMPOSE_WORKDIR,
  hostPath,
  labelsOf,
  git,
  resourceId,
  type AppDb,
  type DockerContainer,
  type ResourceRegistration,
  type ProjectArtifacts,
  type TaskKey,
} from '@skaro/core';
import type { ProjectContext } from './projects';
import { environmentArtifacts } from './task-environment-finished';
import type { EnvironmentRegistry, RetiredEnvironment } from './task-environment-registry';
import { declaredComposeIdentity } from './environment-compose-identity';
import { observedEnvironmentObjectIds } from './environment-resource-observation';

export interface EnvironmentInventoryDeps {
  db: Pick<AppDb, 'getProject' | 'listProjects' | 'resources'>;
  projects: { get(id: string): Pick<ProjectContext, 'root' | 'store'> };
  registry: Pick<EnvironmentRegistry, 'all' | 'retired'>;
  dataDir: string;
  projectScope?: string;
}

export interface EnvironmentObservation {
  resource: ResourceRegistration;
  key?: TaskKey;
  reason?: string;
}

/** Name equality is necessary, but a different Compose directory is conflicting evidence. */
export function environmentDirectoryMatches(
  containers: DockerContainer[],
  composeProject: string,
  expectedPath: string,
): boolean {
  return containers
    .filter((container) => labelsOf(container)[COMPOSE_PROJECT] === composeProject)
    .every((container) => {
      const path = labelsOf(container)[COMPOSE_WORKDIR];
      return !!path && resolve(hostPath(path)) === resolve(expectedPath);
    });
}

/** Reads existing declarations/records and supplied Docker facts; never allocates or writes. */
export async function environmentResourceInventory(
  deps: EnvironmentInventoryDeps,
  containers?: DockerContainer[],
): Promise<EnvironmentObservation[]> {
  const records = [...deps.registry.all(), ...deps.registry.retired()];
  const observations: EnvironmentObservation[] = [];
  const projectIds = new Set([
    ...deps.db.listProjects().map((project) => project.id),
    ...records.map((record) => record.projectId),
  ]);
  for (const projectId of projectIds) {
    if (deps.projectScope && deps.projectScope !== projectId) continue;
    const project = deps.db.getProject(projectId);
    const owned = records.filter((record) => record.projectId === projectId);
    let artifacts: ProjectArtifacts | undefined;
    let root: string | undefined;
    let managed: string | undefined;
    let registeredPaths: string[] | undefined;
    try {
      if (project) {
        root = await realpath(project.path);
        managed = await realpath(deps.dataDir);
        artifacts = await environmentArtifacts(deps.projects.get(projectId));
        try {
          registeredPaths = (await git(root, ['worktree', 'list', '--porcelain', '-z'])).stdout
            .split('\0')
            .filter((line) => line.startsWith('worktree '))
            .map((line) => resolve(line.slice(9)));
        } catch {
          /* A legacy directory alone is not registered worktree evidence. */
        }
      }
    } catch {
      /* Missing metadata is an observation, never proof of deletion. */
    }
    const readable =
      !!artifacts && !artifacts.problems.some((problem) => problem.path === '.skaro/config.yaml');
    const sources = new Set([
      ...(readable && artifacts?.config.environment?.source
        ? [artifacts.config.environment.source.project]
        : []),
      ...owned.flatMap((record) => (record.source ? [record.source.project] : [])),
      ...deps.db.resources
        .list(projectId)
        .filter((record) => record.purpose === 'project-dev')
        .flatMap((record) =>
          record.identity.composeProject ? [record.identity.composeProject] : [],
        ),
    ]);
    for (const name of sources) {
      const saved = deps.db.resources.get(
        resourceId({ projectId, kind: 'environment', identity: { composeProject: name } }),
      );
      const objectIds = observedEnvironmentObjectIds(containers, name, saved?.objectIds);
      observations.push({
        resource: {
          projectId,
          kind: 'environment',
          identity: { composeProject: name },
          owner: { kind: 'project', id: projectId },
          purpose: 'project-dev',
          ownership: 'registered',
          preservation: 'persistent',
          generation: 1,
          consumers: [],
          objectIds,
          state: 'retained',
        },
        reason: 'persistent_source',
      });
    }
    const seen = new Set<string>();
    for (const record of owned) {
      if (seen.has(record.name)) continue;
      seen.add(record.name);
      if (sources.has(record.name)) continue; // Durable purpose wins over a legacy task name.
      const identity = { composeProject: record.name };
      const saved = deps.db.resources.get(resourceId({ projectId, kind: 'environment', identity }));
      const expectedPath = managed ? expectedEnvironmentPath(managed, record) : undefined;
      const subject = artifacts?.tasks.some(
        (task) => task.id === record.taskId || task.milestone === record.taskId,
      );
      const allocated = !!record.allocatedAt || saved?.ownership === 'registered';
      let reason = !project
        ? 'project_unregistered'
        : !readable
          ? 'metadata_unavailable'
          : undefined;
      if (
        !reason &&
        owned.some((other) => other.name === record.name && other.taskId !== record.taskId)
      )
        reason = 'registry_identity_conflict';
      if (!reason && (!expectedPath || !root || expectedPath === root))
        reason = 'identity_unverified';
      if (!reason && !allocated && !subject) reason = 'ownership_unverified';
      let checkoutVerified = false;
      if (expectedPath) {
        try {
          checkoutVerified = resolve(await realpath(expectedPath)) === resolve(expectedPath);
          if (!checkoutVerified) reason = 'path_identity_conflict';
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') reason = 'path_unavailable';
        }
      }
      if (
        !reason &&
        containers &&
        !environmentDirectoryMatches(containers, record.name, expectedPath!)
      ) {
        const declared =
          allocated &&
          checkoutVerified &&
          registeredPaths?.includes(expectedPath!) &&
          containers
            .filter((c) => labelsOf(c)[COMPOSE_PROJECT] === record.name)
            .every((container) =>
              declaredComposeIdentity(
                container,
                {
                  name: record.name,
                  root: root!,
                  worktree: expectedPath!,
                  ports:
                    'ports' in record
                      ? (record as import('./task-environment-registry').EnvironmentRecord).ports
                      : {},
                },
                artifacts?.config.environment,
                deps.dataDir,
              ),
            );
        if (!declared) reason = 'compose_identity_conflict';
      }
      const objectIds = observedEnvironmentObjectIds(containers, record.name, saved?.objectIds);
      if (!reason && saved?.ownership !== 'registered') {
        if (!checkoutVerified) reason = 'checkout_unavailable';
        else if (!registeredPaths) reason = 'git_unavailable';
        else if (!registeredPaths.includes(expectedPath!)) reason = 'ownership_unverified';
        else if (!containers) reason = 'docker_unavailable';
      }
      if (containers && saved?.state === 'released' && objectIds.length)
        reason = 'unexpected_objects_after_release';
      const verified = !reason;
      observations.push({
        key: { projectId, taskId: record.taskId },
        resource: {
          projectId,
          kind: 'environment',
          identity,
          owner: {
            kind: record.taskId.startsWith('integration-') ? 'integration' : 'task',
            id: record.taskId,
          },
          purpose: record.taskId.startsWith('integration-') ? 'integration' : 'task',
          ownership: saved?.ownership ?? (verified ? 'registered' : 'legacy-unverified'),
          preservation: saved?.preservation ?? (verified ? 'disposable' : 'unknown'),
          generation: saved?.generation ?? 1,
          consumers: saved?.consumers ?? [],
          objectIds,
          state: reason || !containers ? 'retained' : 'available',
        },
        reason: reason ?? (!containers ? 'docker_unavailable' : undefined),
      });
    }
  }
  const persistent = new Set([
    ...observations
      .filter((item) => item.resource.purpose === 'project-dev')
      .map((item) => item.resource.identity.composeProject),
    ...deps.db.resources
      .list()
      .filter(
        (resource) => resource.purpose === 'project-dev' || resource.preservation === 'persistent',
      )
      .map((resource) => resource.identity.composeProject),
    ...records.flatMap((record) => (record.source ? [record.source.project] : [])),
  ]);
  for (const observation of observations) {
    if (observation.key && persistent.has(observation.resource.identity.composeProject))
      observation.reason = 'persistent_source';
  }
  return observations;
}

function expectedEnvironmentPath(dataDir: string, record: RetiredEnvironment): string | undefined {
  if (![record.projectId, record.taskId].every((id) => /^[a-z0-9][a-z0-9._-]*$/i.test(id)))
    return undefined;
  const expected = join(dataDir, 'worktrees', record.projectId, record.taskId);
  if (!record.worktree) return expected;
  if (!record.taskId.startsWith('integration-')) return undefined;
  const integration = join(dataDir, 'integrations', record.projectId);
  const path = resolve(record.worktree);
  return path.startsWith(integration + (process.platform === 'win32' ? '\\' : '/'))
    ? path
    : undefined;
}
