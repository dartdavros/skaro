import { readEnvironment, type EnvironmentConfig, type TaskKey } from '@skaro/core';
import type { ConfigureEnvironmentArgs } from '@skaro/mcp-server';
import type { EnvironmentRegistry } from './task-environment-registry';

/** Apply the persisted command without changing project defaults or the rest of the setup. */
export function environmentConfig(
  registry: EnvironmentRegistry,
  key: TaskKey,
  config: EnvironmentConfig,
): EnvironmentConfig {
  const start = registry.find(key)?.start ?? config.start;
  const ports = [...new Set([...config.ports, ...(registry.find(key)?.extraPorts ?? [])])];
  const source = registry.find(key)?.source ?? config.source;
  return { ...config, start, ports, ...(source ? { source } : {}) };
}

/** Compare before saving: an agent must not overwrite a command changed since it read it. */
export function configureEnvironment(
  registry: EnvironmentRegistry,
  key: TaskKey,
  config: EnvironmentConfig,
  args: ConfigureEnvironmentArgs,
): EnvironmentConfig {
  const current = environmentConfig(registry, key, config);
  if (args.ports === undefined && args.start === undefined && args.source === undefined) {
    if (
      args.expectedStart !== undefined ||
      args.expectedPorts !== undefined ||
      args.expectedSource !== undefined
    )
      throw new Error('Provide start/expected_start or ports/expected_ports together.');
    return current;
  }
  if (args.start !== undefined && args.expectedStart !== current.start)
    throw new Error(
      'The launch command changed. Read configure_environment again before updating.',
    );
  const problems: { path: string; message: string }[] = [];
  if (
    args.source !== undefined &&
    JSON.stringify(args.expectedSource) !== JSON.stringify(current.source ?? null)
  )
    throw new Error(
      'The source services changed. Read configure_environment again before updating.',
    );
  if (
    args.ports !== undefined &&
    JSON.stringify(args.expectedPorts) !== JSON.stringify(current.ports)
  )
    throw new Error(
      'The port declarations changed. Read configure_environment again before updating.',
    );
  const next = readEnvironment(
    {
      ...current,
      start: args.start ?? current.start,
      ...(args.source ? { source: args.source } : {}),
      ports: args.ports ? [...new Set([...current.ports, ...args.ports])] : current.ports,
    },
    problems,
  );
  if (!next) throw new Error(problems.map((p) => p.message).join('\n'));
  if (
    !registry.update(key, {
      start: next.start,
      ...(next.source ? { source: next.source } : {}),
      extraPorts: [
        ...new Set([
          ...(registry.find(key)?.extraPorts ?? []),
          ...next.ports.filter((port) => !config.ports.includes(port)),
        ]),
      ],
    })
  )
    throw new Error('The environment no longer exists.');
  return next;
}
