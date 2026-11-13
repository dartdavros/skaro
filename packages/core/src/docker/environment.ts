import { docker, ids } from './cli.ts';
import { COMPOSE_PROJECT, labelsOf, type DockerContainer } from './containers.ts';

const SLOW = { timeoutMs: 120_000 };

/** Stops running containers; their data, volumes and the containers themselves stay. */
export async function stopContainers(containers: DockerContainer[]): Promise<void> {
  const running = containers.filter((c) => c.State?.Running).map((c) => c.Id);
  if (running.length) await docker(['stop', ...running], SLOW);
}

async function listed(kind: 'network' | 'volume' | 'image', label: string): Promise<string[]> {
  // Rebuilds leave untagged intermediate images hidden by the default image listing.
  const args = kind === 'image' ? ['images', '-a', '-q'] : [kind, 'ls', '-q'];
  return [...new Set(ids(await docker([...args, '--filter', `label=${label}`])))];
}

/** Whether the compose project still has volumes: the copy of the data was not removed by hand. */
export async function environmentHasData(name: string): Promise<boolean> {
  return (await listed('volume', `${COMPOSE_PROJECT}=${name}`)).length > 0;
}

/**
 * Ordered exact-object removal. Ancillary objects require independent disposable provenance;
 * neither anonymous attachment nor a Compose label grants deletion authority.
 */
export { removeOwnedEnvironment as removeEnvironment } from './removal.ts';
export type {
  DockerRemovalAuthorization,
  DockerRemovalExecutor,
  DockerRemovalStep,
} from './removal.ts';

/**
 * Only the recorded environment's own project can authorize removal. A project shared with anything
 * else (the main working copy) keeps its networks, volumes and images.
 */
export function ownProjects(
  name: string,
  owned: DockerContainer[],
  all: DockerContainer[],
): string[] {
  const ownedIds = new Set(owned.map((c) => c.Id));
  // A checkout mount or an agent-chosen Compose name is not ownership of that project.
  const candidates = new Set([name]);
  return [...candidates].filter(
    (project): project is string =>
      !!project &&
      !all.some((c) => labelsOf(c)[COMPOSE_PROJECT] === project && !ownedIds.has(c.Id)),
  );
}

const UNITS: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };

/** "Total reclaimed space: 18.39GB" (volumes, images) or "Total: 4.138GB" (build cache). */
export function reclaimedBytes(output: string): number {
  const match = /Total(?: reclaimed space)?:\s*([\d.]+)\s*([KMGT]?B)/i.exec(output);
  return match ? Number(match[1]) * (UNITS[match[2]!.toUpperCase()] ?? 0) : 0;
}

export * from './objects.ts';
