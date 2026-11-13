import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { cacheBudget } from './resource-cache-policy';
import { cacheDirectory, readCacheFile } from './managed-cache-files';
import { managedCacheCommand } from './managed-cache-command';
import {
  BUILDKIT_RECOVERY,
  builderDataVersion,
  ManagedCacheStore,
  type ManagedBuilder,
} from './managed-cache-store';
import type { ManagedBuilderImage } from './managed-buildkit-image';
import {
  managedDockerClientEnvironment,
  managedDockerClientFingerprint,
  type ManagedDockerClient,
} from './managed-docker-client';
import { resourceExecution } from './resource-execution';
import {
  buildkitGcConfiguration,
  verifyBuildkitContainer,
  verifyBuildkitIdentity,
  verifyBuildkitVolume,
  builderVolumeName,
  type BuilderInspection,
  type ContainerInspection,
} from './managed-buildkit-policy';
export { buildkitGcConfiguration, verifyBuildkitIdentity } from './managed-buildkit-policy';
export { bootstrapBuilder } from './managed-buildkit-provision';

export const builderDirectory = (store: ManagedCacheStore, projectId: string) =>
  store.builderPath(projectId);
export const builderEnvironment = managedDockerClientEnvironment;
export async function builderCommand(
  store: ManagedCacheStore,
  entry: ManagedBuilder,
  args: string[],
  teardown = false,
) {
  const env = await builderEnvironment(store, entry);
  return managedCacheCommand(entry.client!.docker, args, {
    cwd: builderDirectory(store, entry.projectId),
    env,
    teardown,
  });
}
/** Pure Docker identity observation; never bootstraps Buildx, including interrupted provisioning. */
export async function inspectOwnedBuilderContainer(
  store: ManagedCacheStore,
  entry: ManagedBuilder,
  teardown = false,
) {
  store.current(entry);
  if (!entry.container) throw new Error('managed_buildkit_exact_container_not_recorded');
  const daemon: unknown = JSON.parse(
    await builderCommand(store, entry, ['info', '--format', '{{json .ID}}'], teardown),
  );
  const containers = JSON.parse(
    await builderCommand(store, entry, ['container', 'inspect', entry.container], teardown),
  ) as ContainerInspection[];
  const volumes = JSON.parse(
    await builderCommand(store, entry, ['volume', 'inspect', builderVolumeName(entry)], teardown),
  ) as unknown[];
  if (typeof daemon !== 'string' || containers.length !== 1 || volumes.length !== 1)
    throw new Error('managed_buildkit_identity_unverified');
  verifyBuildkitVolume(entry, volumes[0]);
  return {
    daemon,
    container: containers[0]!,
    observed: verifyBuildkitContainer(entry, daemon, containers[0]!),
  };
}
export async function inspectBuilder(
  store: ManagedCacheStore,
  entry: ManagedBuilder,
  teardown = false,
) {
  const owned = await inspectOwnedBuilderContainer(store, entry, teardown);
  const instance = join(
    builderDirectory(store, entry.projectId),
    'buildx',
    'instances',
    entry.name,
  );
  const builder = JSON.parse(
    (await readCacheFile(store.root, instance, 128 * 1024)).data.toString('utf8'),
  ) as BuilderInspection;
  return verifyBuildkitIdentity(entry, owned.daemon, builder, owned.container);
}
export async function startBuilder(store: ManagedCacheStore, entry: ManagedBuilder) {
  const inspected = await inspectBuilder(store, entry);
  if (!inspected.running) {
    await builderExternal(store, entry, ['container', 'start', inspected.container]);
    if (!(await inspectBuilder(store, entry)).running)
      throw new Error('managed_buildkit_start_unconfirmed');
  }
}
export async function builderExternal(
  store: ManagedCacheStore,
  entry: ManagedBuilder,
  args: string[],
  teardown = false,
) {
  if (!teardown) await resourceExecution.getStore()?.requireCurrent();
  const pending = store.db.resources.cleanup.read(entry.resourceId)?.externalPending;
  store.db.resources.cleanup.effect(entry.resourceId, true);
  const result = await builderCommand(store, entry, args, teardown);
  // A later successful stop must not erase ambiguity left by an earlier failed executor.
  if (!pending) store.db.resources.cleanup.externalSettled(entry.resourceId);
  return result;
}
export async function allocateBuilder(
  store: ManagedCacheStore,
  projectId: string,
  byteLimit: number,
  entryLimit: number,
  image: ManagedBuilderImage,
  client: ManagedDockerClient,
): Promise<ManagedBuilder> {
  const builders = store.builders(),
    old = builders.find((entry) => entry.projectId === projectId);
  if (!entryLimit || (!old && builders.length + 1 > entryLimit))
    throw new Error('managed_buildkit_builder_entries_budget_retained');
  if (old) {
    if (
      old.state !== 'ready' ||
      !old.endpoint?.startsWith('docker-container://') ||
      !old.client ||
      managedDockerClientFingerprint(old.client) !== managedDockerClientFingerprint(client)
    )
      throw new Error('managed_buildkit_interrupted_or_legacy_profile_retained');
    return old;
  }
  const path = await cacheDirectory(store.root, builderDirectory(store, projectId));
  await cacheDirectory(store.root, join(path, 'buildx'));
  const name = 'skaro-owned-' + randomUUID().replaceAll('-', ''),
    token = randomUUID();
  const policy = buildkitGcConfiguration({
    ...cacheBudget(store.db, 'buildkit'),
    bytes: byteLimit,
  });
  const resource = store.resource(
    projectId,
    path,
    BUILDKIT_RECOVERY,
    builderDataVersion({
      token,
      image: image.id,
      imageSource: image.source,
      imageBytes: image.bytes,
      client,
    }),
  );
  const entry: ManagedBuilder = {
    projectId,
    name,
    token,
    resourceId: resource.id,
    generation: resource.generation,
    state: 'creating',
    client: { ...client },
    daemon: client.daemon,
    policy,
    usedAt: Date.now(),
    image: image.id,
    imageSource: image.source,
    imageBytes: image.bytes,
  };
  store.saveBuilder(entry);
  return entry;
}
