import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ManagedBuilder, ManagedCacheStore } from './managed-cache-store';
import { canonicalCachePath } from './managed-cache-files';
import { publishManagedDockerClient } from './managed-docker-client';
import { provisionManagedBuilderImage, type ManagedBuilderImage } from './managed-buildkit-image';
import {
  builderCommand,
  builderDirectory,
  builderEnvironment,
  builderExternal,
  inspectBuilder,
  inspectOwnedBuilderContainer,
} from './managed-buildkit-identity';
import {
  builderContainerName,
  builderVolumeName,
  builderLabelArguments,
  verifyBuildkitVolume,
} from './managed-buildkit-policy';

/** Supported remote driver avoids docker-container driver's implicit network.host entitlement. */
export async function bootstrapBuilder(
  store: ManagedCacheStore,
  entry: ManagedBuilder,
  image?: ManagedBuilderImage,
): Promise<void> {
  if (entry.container) {
    await inspectBuilder(store, entry);
    return;
  }
  if (entry.state !== 'creating')
    throw new Error('managed_buildkit_incomplete_provisioning_retained');
  await publishManagedDockerClient(store, entry);
  const daemon: unknown = JSON.parse(
    await builderCommand(store, entry, ['info', '--format', '{{json .ID}}']),
  );
  if (
    typeof daemon !== 'string' ||
    !daemon ||
    daemon !== entry.client?.daemon ||
    daemon !== entry.daemon
  )
    throw new Error('managed_buildkit_daemon_unavailable_or_changed');
  if (
    await builderCommand(store, entry, [
      'container',
      'ls',
      '--all',
      '--quiet',
      '--filter',
      `name=^/${builderContainerName(entry)}$`,
    ])
  )
    throw new Error('managed_buildkit_name_already_exists');
  if (
    await builderCommand(store, entry, [
      'volume',
      'ls',
      '--quiet',
      '--filter',
      `name=^${builderVolumeName(entry)}$`,
    ])
  )
    throw new Error('managed_buildkit_foreign_state_volume_exists');
  await provisionManagedBuilderImage(
    builderDirectory(store, entry.projectId),
    image ?? { id: entry.image, source: entry.imageSource, bytes: entry.imageBytes },
    () => store.db.resources.cleanup.effect(entry.resourceId, true),
    () => store.db.resources.cleanup.externalSettled(entry.resourceId),
    { docker: entry.client!.docker, env: await builderEnvironment(store, entry) },
  );
  const config = join(builderDirectory(store, entry.projectId), 'buildkitd.toml');
  await canonicalCachePath(store.root, config, true);
  store.db.resources.cleanup.effect(entry.resourceId);
  await writeFile(config, entry.policy, { flag: 'wx', mode: 0o600 });
  await builderExternal(store, entry, [
    'volume',
    'create',
    '--driver=local',
    ...builderLabelArguments(entry),
    builderVolumeName(entry),
  ]);
  const volumes = JSON.parse(
    await builderCommand(store, entry, ['volume', 'inspect', builderVolumeName(entry)]),
  ) as unknown[];
  if (volumes.length !== 1) throw new Error('managed_buildkit_volume_identity_unverified');
  verifyBuildkitVolume(entry, volumes[0]);
  const container = await builderExternal(store, entry, [
    'container',
    'create',
    '--name',
    builderContainerName(entry),
    '--privileged',
    '--init',
    '--restart=no',
    '--network=bridge',
    '--memory=512m',
    '--memory-swap=512m',
    '--cpu-quota=100000',
    '--cpu-period=100000',
    '--env',
    `SKARO_MANAGED_CACHE_TOKEN=${entry.token}`,
    ...builderLabelArguments(entry),
    '--mount',
    `type=volume,source=${builderVolumeName(entry)},target=/var/lib/buildkit`,
    '--entrypoint=buildkitd',
    entry.image,
    '--config',
    '/buildkitd.toml',
  ]);
  if (!/^[a-f0-9]{64}$/.test(container))
    throw new Error('managed_buildkit_created_container_unverified');
  const resource = store.current(entry);
  store.db.resources.update(resource.id, resource.revision, { objectIds: [container] });
  entry.container = container;
  entry.endpoint = `docker-container://${container}`;
  store.saveBuilder(entry);
  await registerCreatedBuilder(store, entry);
}

/** Complete only a never-started exact allocation inside the caller's exclusive admitted fence. */
export async function registerCreatedBuilder(store: ManagedCacheStore, entry: ManagedBuilder) {
  const container = entry.container;
  const endpoint = `docker-container://${container}`;
  if (!container || entry.endpoint !== endpoint || !['creating', 'retained'].includes(entry.state))
    throw new Error('managed_buildkit_created_registration_required');
  const state = JSON.parse(
    await builderCommand(store, entry, [
      'container',
      'inspect',
      container,
      '--format',
      '{{json .State}}',
    ]),
  );
  if (
    state.Status !== 'created' ||
    state.Running ||
    state.Pid !== 0 ||
    state.StartedAt !== '0001-01-01T00:00:00Z'
  )
    throw new Error('managed_buildkit_created_registration_required');
  const config = join(builderDirectory(store, entry.projectId), 'buildkitd.toml');
  await inspectOwnedBuilderContainer(store, entry);
  await builderExternal(store, entry, ['container', 'cp', config, `${container}:/buildkitd.toml`]);
  await inspectOwnedBuilderContainer(store, entry);
  await builderExternal(store, entry, ['container', 'start', container]);
  await inspectOwnedBuilderContainer(store, entry);
  await builderExternal(store, entry, [
    'buildx',
    'create',
    '--name',
    entry.name,
    '--driver',
    'remote',
    '--bootstrap',
    endpoint,
  ]);
  await inspectBuilder(store, entry);
  entry.state = 'ready';
  store.saveBuilder(entry);
  store.outcome(entry, 'observed', 'managed_buildkit_owned_remote_builder_created');
}
