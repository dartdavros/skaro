import { docker, ids } from './cli.ts';
import { COMPOSE_PROJECT, type DockerContainer } from './containers.ts';

export type DockerObjectKind = 'network' | 'volume' | 'image';
export interface DockerObjectIdentity {
  kind: DockerObjectKind;
  /** Immutable ID for images/networks; Docker volumes have only a name, paired with CreatedAt. */
  id: string;
  name: string;
  createdAt: string;
  labels: Record<string, string>;
  tags: string[];
}

export async function inspectDockerObject(
  kind: DockerObjectKind,
  id: string,
): Promise<DockerObjectIdentity> {
  const [row] = JSON.parse(await docker([kind, 'inspect', id])) as Record<string, unknown>[];
  if (!row) throw new Error('Docker object inspection returned no identity');
  const config = row.Config as { Labels?: Record<string, string> } | undefined;
  const identity = {
    kind,
    id: String(kind === 'volume' ? row.Name : row.Id),
    name: String(row.Name ?? row.Id),
    createdAt: String(row.CreatedAt ?? row.Created ?? ''),
    labels: (row.Labels ?? config?.Labels ?? {}) as Record<string, string>,
    tags: Array.isArray(row.RepoTags) ? (row.RepoTags as string[]) : [],
  };
  if (!identity.id || identity.id === 'undefined' || !identity.createdAt)
    throw new Error('Docker object has no exact creation identity');
  return identity;
}

/** Discovery is not authority: include attached unlabelled objects so unknown leftovers are retained. */
export async function inspectEnvironmentObjects(
  projects: string[],
  containers: DockerContainer[] = [],
): Promise<DockerObjectIdentity[]> {
  const result: DockerObjectIdentity[] = [];
  for (const kind of ['network', 'volume', 'image'] as const) {
    const candidates = new Set<string>();
    for (const project of projects) {
      const args = kind === 'image' ? ['images', '-a', '-q', '--no-trunc'] : [kind, 'ls', '-q'];
      for (const id of ids(
        await docker([...args, '--filter', `label=${COMPOSE_PROJECT}=${project}`]),
      ))
        candidates.add(id);
    }
    for (const container of containers) {
      if (kind === 'image' && container.Image) candidates.add(container.Image);
      if (kind === 'volume')
        for (const mount of container.Mounts)
          if (mount.Type === 'volume' && mount.Name) candidates.add(mount.Name);
      if (kind === 'network')
        for (const network of Object.values(container.NetworkSettings?.Networks ?? {}))
          if (network.NetworkID) candidates.add(network.NetworkID);
    }
    for (const id of candidates) {
      const object = await inspectDockerObject(kind, id);
      // Pulled/shared images and built-in/external networks are outside this environment scope.
      if (kind !== 'volume' && !projects.includes(object.labels[COMPOSE_PROJECT] ?? '')) continue;
      result.push(object);
    }
  }
  return result;
}

/** Full fingerprints protect same-name volume replacement and label/name changes. */
export function sameDockerObject(a: DockerObjectIdentity, b: DockerObjectIdentity): boolean {
  const labels = (value: Record<string, string>) =>
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return (
    a.kind === b.kind &&
    a.id === b.id &&
    a.name === b.name &&
    a.createdAt === b.createdAt &&
    JSON.stringify(labels(a.labels)) === JSON.stringify(labels(b.labels)) &&
    JSON.stringify([...a.tags].sort()) === JSON.stringify([...b.tags].sort())
  );
}

export function dockerObjectInUse(
  object: DockerObjectIdentity,
  containers: DockerContainer[],
): boolean {
  return containers.some((container) =>
    object.kind === 'image'
      ? container.Image === object.id
      : object.kind === 'volume'
        ? container.Mounts.some((mount) => mount.Type === 'volume' && mount.Name === object.id)
        : Object.values(container.NetworkSettings?.Networks ?? {}).some(
            (network) => network.NetworkID === object.id,
          ),
  );
}

/** Pre-create read-only inventory: existing IDs/names can never be adopted as new disposable data. */
export async function dockerObjectIds(): Promise<Record<DockerObjectKind, string[]>> {
  return {
    network: ids(await docker(['network', 'ls', '-q', '--no-trunc'])),
    volume: ids(await docker(['volume', 'ls', '-q'])),
    image: ids(await docker(['images', '-a', '-q', '--no-trunc'])),
  };
}
