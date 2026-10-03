import { isAbsolute, relative, resolve, sep } from 'node:path';
import { docker, ids } from './cli.ts';

/** `docker inspect` of a container, the fields Skaro reads. Stopped containers are included. */
export interface DockerContainer {
  Id: string;
  Name: string;
  State?: { Running?: boolean };
  Config?: { Labels?: Record<string, string> | null };
  Mounts: { Type: string; Source: string }[];
}

export const COMPOSE_PROJECT = 'com.docker.compose.project';
export const COMPOSE_WORKDIR = 'com.docker.compose.project.working_dir';

export async function inspectContainers(): Promise<DockerContainer[]> {
  const all = ids(await docker(['ps', '-aq']));
  const records: DockerContainer[] = [];
  for (let i = 0; i < all.length; i += 50) {
    records.push(...(JSON.parse(await docker(['inspect', ...all.slice(i, i + 50)])) as []));
  }
  return records;
}

export function labelsOf(container: DockerContainer): Record<string, string> {
  return container.Config?.Labels ?? {};
}

/** A separator boundary matters: T-007 must not match T-007-other. */
export function containsPath(parent: string, child: string): boolean {
  const path = relative(resolve(hostPath(parent)), resolve(hostPath(child)));
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

/** Docker Desktop may report a Windows bind source in Linux notation. */
export function hostPath(path: string): string {
  if (process.platform !== 'win32') return path;
  return path.replace(/^\/(?:run\/desktop\/mnt\/host|host_mnt)\/([a-z])\//i, '$1:/');
}

/** Folders on the host a container was started from or reads: its compose folder and bind mounts. */
export function hostFolders(container: DockerContainer): string[] {
  const workdir = labelsOf(container)[COMPOSE_WORKDIR];
  return [
    ...(workdir ? [workdir] : []),
    ...container.Mounts.filter((mount) => mount.Type === 'bind').map((mount) => mount.Source),
  ];
}
