import { existsSync } from 'node:fs';
import {
  ensureSourceServices,
  expand,
  runShell,
  waitReady,
  type DockerContainer,
  type EnvironmentConfig,
  type TaskKey,
} from '@skaro/core';
import { admitCompose } from './task-compose';
import type { EnvironmentDescription } from './task-environment-description';
import type { EnvironmentRegistry } from './task-environment-registry';
import type { EnvironmentDocker } from './task-environment-docker';
import { environmentReadinessProblems } from './task-environment-readiness';

export interface EnvironmentStartOptions {
  signal?: AbortSignal;
  processStarted?: (pid: number) => void | Promise<void>;
  assertActive?: () => void;
}

export interface EnvironmentStartTiming {
  at: number;
  queuedMs: number;
  prepareMs: number;
  createMs: number;
  startMs: number;
  readyMs: number;
  reusedData: boolean;
  error?: string;
}

/** One launch, including its measured preparation cost. Data is copied only on first use. */
export async function startEnvironmentServices(
  key: TaskKey,
  requestedAt: number,
  startedAt: number,
  options: EnvironmentStartOptions,
  deps: {
    registry: EnvironmentRegistry;
    docker: EnvironmentDocker;
    describe: () => Promise<EnvironmentDescription>;
    prepare: () => Promise<void>;
    provenance: (description: EnvironmentDescription) => Promise<() => Promise<void>>;
    remove: () => Promise<string[]>;
    sourceObserved: (
      source: NonNullable<EnvironmentConfig['source']>,
      containers: DockerContainer[],
    ) => () => void;
  },
) {
  const timing: EnvironmentStartTiming = {
    at: startedAt,
    queuedMs: startedAt - requestedAt,
    prepareMs: Date.now() - startedAt,
    createMs: 0,
    startMs: 0,
    readyMs: 0,
    reusedData: false,
  };
  const timed = async <T>(
    part: 'prepareMs' | 'createMs' | 'startMs' | 'readyMs',
    action: () => Promise<T>,
  ) => {
    options.assertActive?.();
    options.signal?.throwIfAborted();
    const began = Date.now();
    try {
      return await action();
    } finally {
      timing[part] += Date.now() - began;
    }
  };
  try {
    const description = await timed('prepareMs', async () => {
      await deps.prepare();
      const description = await deps.describe();
      if (!existsSync(description.identity.worktree))
        throw new Error('The task has no checkout of its own.');
      if (!description.config) throw new Error('The project describes no task environment.');
      return description;
    });
    const { identity, config, variables, compose } = description;
    let completeProvenance: (() => Promise<void>) | undefined;
    const portBindings = compose
      ? await timed('prepareMs', () => admitCompose(identity, compose))
      : undefined;
    const run = (label: string, command: string) =>
      runShell(expand(command, identity), {
        cwd: identity.worktree,
        env: variables,
        label,
        timeoutMs: 30 * 60_000,
        ...options,
      });
    if (config!.create) {
      timing.reusedData =
        !!deps.registry.find(key)?.created && (await deps.docker.hasData(identity.name));
      if (!timing.reusedData)
        await timed('createMs', async () => {
          let releaseSource: (() => void) | undefined;
          try {
            if (config!.source)
              await ensureSourceServices(
                identity.root,
                config!.source,
                identity.name,
                options.signal,
                (containers) => {
                  releaseSource = deps.sourceObserved(config!.source!, containers);
                },
              );
            const failures = await deps.remove();
            if (failures.length)
              throw new Error(`Cannot prepare a clean environment: ${failures.join('; ')}`);
            options.assertActive?.();
            options.signal?.throwIfAborted();
            completeProvenance = await deps.provenance(description);
            await run('create', config!.create!);
            deps.registry.update(key, { created: true });
          } finally {
            releaseSource?.();
          }
        });
    }
    completeProvenance ??= await deps.provenance(description);
    await timed('startMs', () => run('start', config!.start));
    if (config!.ready)
      await timed('readyMs', () =>
        waitReady(expand(config!.ready!, identity), {
          ...(options.signal ? { signal: options.signal } : {}),
        }),
      );
    options.signal?.throwIfAborted();
    if (compose) {
      const problems = await timed('readyMs', async () =>
        environmentReadinessProblems(await deps.docker.inspect(), identity.name),
      );
      if (problems.length)
        throw new Error(`Environment services are not ready: ${problems.join('; ')}`);
    }
    await completeProvenance();
    return {
      name: identity.name,
      urls: Object.fromEntries(
        Object.entries(config!.urls).map(([name, url]) => [name, expand(url, identity)]),
      ),
      ...(portBindings ? { portBindings } : {}),
    };
  } catch (error) {
    timing.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    deps.registry.update(key, { lastStart: timing });
  }
}
