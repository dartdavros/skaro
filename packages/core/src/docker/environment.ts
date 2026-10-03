import { docker, ids } from './cli.ts';
import { COMPOSE_PROJECT, labelsOf, type DockerContainer } from './containers.ts';

const SLOW = { timeoutMs: 120_000 };

/** Stops running containers; their data, volumes and the containers themselves stay. */
export async function stopContainers(containers: DockerContainer[]): Promise<void> {
  const running = containers.filter((c) => c.State?.Running).map((c) => c.Id);
  if (running.length) await docker(['stop', ...running], SLOW);
}

async function listed(kind: 'network' | 'volume' | 'image', label: string): Promise<string[]> {
  const args = kind === 'image' ? ['images', '-q'] : [kind, 'ls', '-q'];
  return [...new Set(ids(await docker([...args, '--filter', `label=${label}`])))];
}

/** Whether the compose project still has volumes: the copy of the data was not removed by hand. */
export async function environmentHasData(name: string): Promise<boolean> {
  return (await listed('volume', `${COMPOSE_PROJECT}=${name}`)).length > 0;
}

/**
 * Removes a disposable task environment: its containers with their anonymous volumes, then the
 * networks, volumes and locally built images of its compose projects. Every step is tried;
 * the failures come back together.
 */
export async function removeEnvironment(
  containers: DockerContainer[],
  projects: string[],
): Promise<string[]> {
  const failures: string[] = [];
  const attempt = async (what: string, action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      failures.push(`${what}: ${error instanceof Error ? error.message.trim() : String(error)}`);
    }
  };
  if (containers.length) {
    await attempt('containers', () =>
      docker(['rm', '-f', '-v', ...containers.map((c) => c.Id)], SLOW),
    );
  }
  const labels = projects.map((p) => `${COMPOSE_PROJECT}=${p}`);
  for (const kind of ['network', 'volume', 'image'] as const) {
    for (const label of labels) {
      await attempt(`${kind}s of ${label}`, async () => {
        const found = await listed(kind, label);
        if (!found.length) return;
        // An image another container still uses stays: only unused tags are removed.
        await docker(kind === 'image' ? ['rmi', ...found] : [kind, 'rm', ...found], SLOW);
      });
    }
  }
  return failures;
}

/**
 * Compose projects that belong to the environment entirely: the environment's own project and
 * projects none of whose containers lies outside the removed set. A project shared with anything
 * else (the main working copy) keeps its networks, volumes and images.
 */
export function ownProjects(
  name: string,
  owned: DockerContainer[],
  all: DockerContainer[],
): string[] {
  const ownedIds = new Set(owned.map((c) => c.Id));
  const candidates = new Set([name, ...owned.map((c) => labelsOf(c)[COMPOSE_PROJECT])]);
  return [...candidates].filter(
    (project): project is string =>
      !!project &&
      !all.some((c) => labelsOf(c)[COMPOSE_PROJECT] === project && !ownedIds.has(c.Id)),
  );
}
