import type { CacheBudget } from './resource-cache-policy';
import type { ManagedBuilder } from './managed-cache-store';
import { MANAGED_BUILDER_MEMORY } from './managed-cache-admission';

export function buildkitGcConfiguration(budget: CacheBudget): string {
  if (
    !Number.isSafeInteger(budget.bytes) ||
    budget.bytes < 1 ||
    !Number.isSafeInteger(budget.idleMs) ||
    budget.idleMs < 0
  )
    throw new Error('managed_buildkit_cache_disabled');
  const seconds = Math.max(1, Math.floor(budget.idleMs / 1000));
  const limits = `  reservedSpace = 0\n  maxUsedSpace = ${budget.bytes}\n  minFreeSpace = 0\n`;
  return `insecure-entitlements = []\n[cdi]\n  disabled = true\n[worker.oci]\n  max-parallelism = 1\n  gc = true\n${limits}[[worker.oci.gcpolicy]]\n  keepDuration = "${seconds}s"\n${limits}  all = true\n[[worker.oci.gcpolicy]]\n${limits}  all = true\n`;
}
export interface BuilderInspection {
  Name?: string;
  Driver?: string;
  Nodes?: {
    Name?: string;
    Endpoint?: string;
    DriverOpts?: Record<string, string>;
    BuildkitdFlags?: string[];
    Flags?: string[];
    Files?: Record<string, string> | null;
  }[];
}
export interface ContainerInspection {
  Id?: string;
  Name?: string;
  Image?: string;
  Config?: {
    Image?: string;
    Env?: string[];
    Cmd?: string[];
    Entrypoint?: string[];
    Labels?: Record<string, string>;
  };
  State?: { Running?: boolean };
  Mounts?: { Type?: string; Name?: string; Destination?: string; RW?: boolean }[];
  HostConfig?: {
    Memory?: number;
    MemorySwap?: number;
    CpuQuota?: number;
    CpuPeriod?: number;
    Privileged?: boolean;
    Init?: boolean;
    RestartPolicy?: { Name?: string; MaximumRetryCount?: number };
    NetworkMode?: string;
    Binds?: unknown[] | null;
    SecurityOpt?: string[] | null;
    Devices?: unknown[] | null;
    DeviceRequests?: unknown[] | null;
    CapAdd?: string[] | null;
    PortBindings?: Record<string, unknown> | null;
    PidMode?: string;
    VolumesFrom?: string[] | null;
  };
}
export const builderContainerName = (entry: ManagedBuilder) => `buildx_buildkit_${entry.name}0`;
export const builderVolumeName = (entry: ManagedBuilder) => `${builderContainerName(entry)}_state`;
export const builderLabels = (entry: ManagedBuilder) => ({
  'skaro.managed-cache.token': entry.token,
  'skaro.managed-cache.resource': entry.resourceId,
  'skaro.managed-cache.generation': String(entry.generation),
});
export const builderLabelArguments = (entry: ManagedBuilder) =>
  Object.entries(builderLabels(entry)).flatMap(([key, value]) => ['--label', `${key}=${value}`]);
export function verifyBuildkitContainer(
  entry: ManagedBuilder,
  daemon: string,
  container: ContainerInspection,
) {
  const host = container.HostConfig,
    mount = container.Mounts?.[0];
  if (
    !entry.daemon ||
    entry.daemon !== daemon ||
    !container.Id ||
    !/^[a-f0-9]{64}$/.test(container.Id) ||
    container.Name !== `/${builderContainerName(entry)}` ||
    typeof container.State?.Running !== 'boolean' ||
    !container.Config?.Env?.includes(`SKARO_MANAGED_CACHE_TOKEN=${entry.token}`) ||
    Object.entries(builderLabels(entry)).some(
      ([key, value]) => container.Config?.Labels?.[key] !== value,
    ) ||
    JSON.stringify(container.Config.Cmd) !== JSON.stringify(['--config', '/buildkitd.toml']) ||
    JSON.stringify(container.Config.Entrypoint) !== JSON.stringify(['buildkitd']) ||
    container.Config.Image !== entry.image ||
    !entry.container ||
    container.Id !== entry.container ||
    container.Image !== entry.image ||
    !/^sha256:[a-f0-9]{64}$/.test(container.Image ?? '') ||
    host?.Memory !== MANAGED_BUILDER_MEMORY ||
    host.MemorySwap !== MANAGED_BUILDER_MEMORY ||
    host.CpuQuota !== 100000 ||
    host.CpuPeriod !== 100000 ||
    host.Privileged !== true ||
    host.Init !== true ||
    host.RestartPolicy?.Name !== 'no' ||
    (host.RestartPolicy.MaximumRetryCount ?? 0) !== 0 ||
    host.NetworkMode !== 'bridge' ||
    host.Binds?.length ||
    (host.SecurityOpt?.length &&
      !(host.SecurityOpt.length === 1 && host.SecurityOpt[0] === 'label=disable')) ||
    host.Devices?.length ||
    host.DeviceRequests?.length ||
    host.CapAdd?.length ||
    host.VolumesFrom?.length ||
    (host.PidMode ?? '') !== '' ||
    Object.keys(host.PortBindings ?? {}).length ||
    container.Mounts?.length !== 1 ||
    mount?.Type !== 'volume' ||
    mount.Name !== builderVolumeName(entry) ||
    mount.Destination !== '/var/lib/buildkit' ||
    mount.RW !== true
  )
    throw new Error('managed_buildkit_identity_unverified');
  return {
    container: container.Id,
    image: container.Image!,
    endpoint: `docker-container://${container.Id}`,
    running: container.State.Running,
  };
}
/** Remote connection helper is an exact docker-exec tunnel, never an exposed TCP endpoint. */
export function verifyBuildkitIdentity(
  entry: ManagedBuilder,
  daemon: string,
  builder: BuilderInspection,
  container: ContainerInspection,
) {
  const observed = verifyBuildkitContainer(entry, daemon, container),
    node = builder.Nodes?.[0];
  if (
    builder.Name !== entry.name ||
    builder.Driver !== 'remote' ||
    builder.Nodes?.length !== 1 ||
    node?.Name !== `${entry.name}0` ||
    node.Endpoint !== observed.endpoint ||
    entry.endpoint !== observed.endpoint ||
    Object.keys(node.DriverOpts ?? {}).length ||
    node.BuildkitdFlags?.length ||
    node.Flags?.length ||
    Object.keys(node.Files ?? {}).length
  )
    throw new Error('managed_buildkit_identity_unverified');
  return observed;
}
export function verifyBuildkitVolume(entry: ManagedBuilder, value: unknown) {
  const volume = value as {
    Name?: string;
    Driver?: string;
    Options?: Record<string, string> | null;
    Labels?: Record<string, string>;
  };
  if (
    !volume ||
    volume.Name !== builderVolumeName(entry) ||
    volume.Driver !== 'local' ||
    Object.keys(volume.Options ?? {}).length ||
    Object.entries(builderLabels(entry)).some(
      ([key, expected]) => volume.Labels?.[key] !== expected,
    )
  )
    throw new Error('managed_buildkit_volume_identity_unverified');
}
