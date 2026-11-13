import { portIsFree, type DockerContainer, type TaskKey } from '@skaro/core';
import { namedContainers, type EnvironmentDocker } from './task-environment-docker';
import type { EnvironmentRecord, EnvironmentRegistry } from './task-environment-registry';

function publishedPorts(containers: DockerContainer[]): Set<number> {
  return new Set(
    containers.flatMap((container) =>
      Object.values(container.NetworkSettings?.Ports ?? {}).flatMap((bindings) =>
        (bindings ?? []).map((binding) => Number(binding.HostPort)),
      ),
    ),
  );
}

/** A running service keeps its own port; stopped containers do not reserve host sockets. */
export async function unavailablePorts(
  record: EnvironmentRecord,
  containers: DockerContainer[],
  free: (port: number) => Promise<boolean> = portIsFree,
): Promise<string[]> {
  const running = namedContainers(containers, record.name).filter(
    (container) => container.State?.Running,
  );
  const held = publishedPorts(running);
  // Docker forwarding can own a port even when a host socket probe reports it free (Windows/WSL).
  const foreign = publishedPorts(
    containers.filter(
      (container) => container.State?.Running && !running.some((own) => own.Id === container.Id),
    ),
  );
  const checks = await Promise.all(
    Object.entries(record.ports).map(async ([name, port]) =>
      foreign.has(port) || (!held.has(port) && !(await free(port))) ? name : undefined,
    ),
  );
  return checks.filter((name): name is string => name !== undefined);
}

/** Executed under the allocation queue, immediately before Compose admission/start. */
export async function refreshEnvironmentPorts(
  registry: EnvironmentRegistry,
  key: TaskKey,
  docker: EnvironmentDocker,
): Promise<void> {
  const record = registry.find(key)!;
  const containers = await docker.inspect();
  const missing = await unavailablePorts(record, containers);
  if (!missing.length) return;
  const taken = new Set([
    ...registry.takenPorts(),
    ...publishedPorts(containers.filter((c) => c.State?.Running)),
  ]);
  const replacements = await docker.ports(missing.length, taken);
  registry.update(key, {
    previousPorts: {
      ...record.previousPorts,
      ...Object.fromEntries(
        missing.map((name) => [
          name,
          [...new Set([...(record.previousPorts?.[name] ?? []), record.ports[name]!])],
        ]),
      ),
    },
    ports: {
      ...record.ports,
      ...Object.fromEntries(missing.map((name, index) => [name, replacements[index]!])),
    },
  });
}
