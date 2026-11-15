import { join } from 'node:path';
import type { ManagedCacheStore, ManagedBuilder } from './managed-cache-store';
import { managedBuilderAuthority } from './managed-buildkit-authority';
import {
  builderCommand,
  builderDirectory,
  builderExternal,
  inspectBuilder,
  inspectOwnedBuilderContainer,
} from './managed-buildkit-identity';
import {
  builderVolumeName,
  verifyBuildkitVolume,
  type ContainerInspection,
} from './managed-buildkit-policy';
import { buildkitUsage } from './managed-buildkit-runtime';
import { createOwnedBuilderContainer } from './managed-buildkit-provision';
import {
  migrateBuilderPolicy,
  unrestrictedBuilderPolicy,
} from './managed-buildkit-policy-migration';

export const hasLegacyBuilderLimits = (host: ContainerInspection['HostConfig']) =>
  (host?.Memory ?? 0) > 0 || (host?.MemorySwap ?? 0) > 0 || (host?.CpuQuota ?? 0) > 0;

/** No Docker update can unset its old memory limit. Replace only our exact idle container, retaining data. */
export async function removeLegacyBuilderLimits(store: ManagedCacheStore, entry: ManagedBuilder) {
  if (!entry.container) return;
  managedBuilderAuthority(entry);
  await inspectBuilder(store, entry);
  const owned = await inspectOwnedBuilderContainer(store, entry);
  if (
    !hasLegacyBuilderLimits(owned.container.HostConfig) &&
    unrestrictedBuilderPolicy(entry.policy) === entry.policy
  )
    return;
  const id = owned.observed.container;
  if (owned.observed.running) {
    const usage = buildkitUsage(
      await builderCommand(store, entry, [
        'container',
        'exec',
        id,
        'buildctl',
        '--addr',
        'unix:///run/buildkit/buildkitd.sock',
        'du',
        '--format',
        '{{json .}}',
      ]),
    );
    if (usage.inUse) throw new Error('managed_buildkit_active_consumer');
    await builderExternal(store, entry, ['container', 'stop', '--time', '15', id]);
    if ((await inspectOwnedBuilderContainer(store, entry)).observed.running)
      throw new Error('managed_buildkit_stop_unconfirmed');
  }
  entry.state = 'retained';
  store.saveBuilder(entry);
  entry.policy = await migrateBuilderPolicy(
    store.root,
    join(builderDirectory(store, entry.projectId), 'buildkitd.toml'),
    entry.policy,
    () => {
      managedBuilderAuthority(entry);
      store.db.resources.cleanup.effect(entry.resourceId);
    },
  );
  store.saveBuilder(entry);
  // This is the private verified remote registration; the cache volume is never removed.
  await builderExternal(store, entry, [
    'buildx',
    'rm',
    '--keep-daemon',
    '--keep-state',
    entry.name,
  ]);
  await inspectOwnedBuilderContainer(store, entry);
  await builderExternal(store, entry, ['container', 'rm', id]);
  if (
    await builderCommand(store, entry, [
      'container',
      'ls',
      '--all',
      '--quiet',
      '--filter',
      `id=${id}`,
    ])
  )
    throw new Error('managed_buildkit_old_container_removal_unconfirmed');
  const volumes = JSON.parse(
    await builderCommand(store, entry, ['volume', 'inspect', builderVolumeName(entry)]),
  ) as unknown[];
  if (volumes.length !== 1) throw new Error('managed_buildkit_volume_identity_unverified');
  verifyBuildkitVolume(entry, volumes[0]);
  entry.container = undefined;
  entry.endpoint = undefined;
  entry.state = 'creating';
  store.saveBuilder(entry);
  await createOwnedBuilderContainer(store, entry);
  const replacement = await inspectOwnedBuilderContainer(store, entry);
  if (hasLegacyBuilderLimits(replacement.container.HostConfig))
    throw new Error('managed_buildkit_unrestricted_replacement_unconfirmed');
  store.outcome(entry, 'observed', 'managed_buildkit_legacy_caps_removed_cache_preserved');
}
