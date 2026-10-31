import { relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { EnvironmentConfig } from '../artifacts/model.ts';
import { docker } from './cli.ts';
import {
  COMPOSE_PROJECT,
  COMPOSE_WORKDIR,
  hostPath,
  inspectContainers,
  labelsOf,
  type DockerContainer,
} from './containers.ts';

/** Validate the entire declaration before starting anything. Main-copy services are never created. */
export function sourceContainers(
  all: DockerContainer[],
  root: string,
  source: NonNullable<EnvironmentConfig['source']>,
  taskName: string,
): DockerContainer[] {
  if (source.project === taskName)
    throw new Error('The data source must be the main checkout, not a task environment.');
  return [...new Set(source.services)].map((service) => {
    const matches = all.filter((container) => {
      const labels = labelsOf(container);
      return (
        labels[COMPOSE_PROJECT] === source.project &&
        labels['com.docker.compose.service'] === service &&
        labels['com.docker.compose.oneoff']?.toLowerCase() !== 'true'
      );
    });
    if (matches.length !== 1)
      throw new Error(
        `Source service ${source.project}/${service}: expected one existing container, found ${matches.length}. No source containers were created.`,
      );
    const container = matches[0]!;
    const folder = labelsOf(container)[COMPOSE_WORKDIR];
    if (!folder || relative(resolve(hostPath(folder)), resolve(root)) !== '')
      throw new Error(
        `Source service ${source.project}/${service} does not belong to the main checkout.`,
      );
    return container;
  });
}

/** Start only the declared existing source containers; leave mounts, images, accounts and data intact. */
export async function ensureSourceServices(
  root: string,
  source: NonNullable<EnvironmentConfig['source']>,
  taskName: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const selected = sourceContainers(await inspectContainers(), root, source, taskName);
  const stopped = selected.filter((container) => !container.State?.Running);
  if (stopped.length) {
    signal?.throwIfAborted();
    await docker(['start', ...stopped.map((container) => container.Id)], { timeoutMs: 120_000 });
  }
  // Existing databases on Docker Desktop may spend minutes checking Windows bind mounts
  // and recovering after an unclean host shutdown. Keep that work within the managed launch.
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    signal?.throwIfAborted();
    const current = JSON.parse(
      await docker(['inspect', ...selected.map((container) => container.Id)]),
    ) as Array<{
      Id: string;
      State: { Running: boolean; Health?: { Status: string } };
    }>;
    if (current.length !== selected.length)
      throw new Error(`Source services of ${source.project} changed during startup.`);
    if (current.some((container) => !container.State.Running))
      throw new Error(
        `Source services of ${source.project} exited during startup; source data was not replaced.`,
      );
    if (
      current.every(
        (container) => !container.State.Health || container.State.Health.Status === 'healthy',
      )
    )
      return;
    if (Date.now() >= deadline)
      throw new Error(`Source services of ${source.project} did not become healthy.`);
    await delay(1_000, undefined, { signal });
  }
}
