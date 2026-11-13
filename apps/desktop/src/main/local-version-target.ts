import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative } from 'node:path';
import {
  COMPOSE_PROJECT,
  COMPOSE_WORKDIR,
  hostPath,
  labelsOf,
  type AppDb,
  type DockerContainer,
} from '@skaro/core';
import type { LocalVersionTarget } from '../shared/local-versions';
import { readCompose } from './task-compose';
import { memoryVersion, requireMemoryPath } from './project-memory-sources';
import { systemDocker } from './task-environment-docker';
import { persistentComposeData } from './local-data-contract';

export async function inspectLocalTarget(db: AppDb, target: LocalVersionTarget, release?: string) {
  const project = db.getProject(target.projectId);
  if (!project || (db.shell.projectScope && db.shell.projectScope !== target.projectId))
    throw new Error('Local target project is unavailable');
  const root = await realpath(project.path);
  const composeFile = await requireMemoryPath(root, target.composeFile);
  const resource = db.resources.get(target.resourceId);
  if (
    !resource ||
    resource.projectId !== project.id ||
    resource.kind !== 'environment' ||
    resource.purpose !== 'project-dev' ||
    resource.preservation !== 'persistent' ||
    resource.ownership !== 'registered' ||
    resource.owner.id !== project.id
  )
    throw new Error('Local target must be an explicitly registered persistent project environment');
  if (!/^[A-Z_][A-Z0-9_]*$/.test(target.codeVariable) || !target.dataVersion.trim())
    throw new Error('Local target requires an explicit code variable and data version');
  const url = new URL(target.ready);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error('Installation target must have local credential-free readiness');
  const variables = {
    ...target.variables,
    ...(release ? { [target.codeVariable]: release } : {}),
    COMPOSE_FILE: composeFile,
    COMPOSE_PROJECT_NAME: resource.identity.composeProject!,
  };
  const model = await readCompose(dirname(composeFile), variables);
  const containers = (await systemDocker.inspect()).filter(
    (c) => labelsOf(c)[COMPOSE_PROJECT] === resource.identity.composeProject,
  );
  for (const container of containers) {
    const cwd = labelsOf(container)[COMPOSE_WORKDIR];
    if (!cwd || (await realpath(hostPath(cwd))) !== (await realpath(dirname(composeFile))))
      throw new Error('Local target Compose directory identity changed');
  }
  const persistent = persistentComposeData(model);
  if (persistent.length && (!target.checkpoint || !target.restore))
    throw new Error('Persistent writable data requires declared checkpoint and restore commands');
  if (release) {
    const canonical = await realpath(release);
    let bound = false;
    for (const service of Object.values(model.services))
      for (const mount of (service.volumes ?? []) as {
        type: string;
        source?: string;
        read_only?: boolean;
      }[]) {
        if (mount.type !== 'bind' || !mount.source) continue;
        const path = await realpath(mount.source);
        const suffix = relative(canonical, path);
        if (!suffix || (!suffix.startsWith('..') && !isAbsolute(suffix))) {
          if (!mount.read_only) throw new Error('Installed code must be mounted read-only');
          bound = true;
        }
      }
    if (!bound) throw new Error('Target does not bind the immutable installed version');
  }
  return {
    root,
    composeFile,
    variables,
    model,
    containers,
    resource,
    dataFingerprint: memoryVersion(persistent),
    configuration: memoryVersion(model),
  };
}

export function localDataObjects(containers: DockerContainer[]): string {
  return memoryVersion(
    containers
      .flatMap((c) =>
        (c.Mounts ?? [])
          .filter((m) => m.Type === 'volume' || (m.Type === 'bind' && m.RW))
          .map((m) => [m.Type, m.Name, m.Source, m.Destination]),
      )
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}

/** Only the code pointer and generated revision may change as part of this receipt. */
export function localTargetContract(target: LocalVersionTarget): string {
  const { revision: _revision, configuration: _configuration, variables, ...contract } = target;
  const { [target.codeVariable]: _code, ...environment } = variables;
  return memoryVersion([contract, environment]);
}
