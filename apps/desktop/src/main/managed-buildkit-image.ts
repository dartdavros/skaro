import { managedCacheCommand } from './managed-cache-command';
import { UnsupportedManagedBuild } from './managed-build-source';
import { resolveOfficialBuilderImage } from './managed-buildkit-acquisition';
import { observedDockerEnvironment } from './managed-docker-observation';
import type { ManagedDockerClient } from './managed-docker-client';
import { resourceExecution } from './resource-execution';

export interface ManagedBuilderImage {
  id: string;
  source: string;
  bytes: number;
  acquisition?: 'official-registry-pinned';
  sizeKnowledge?: 'conservative-expanded-estimate';
}
interface DockerExecution {
  docker: string;
  env: NodeJS.ProcessEnv;
}
export function verifiedManagedBuilderImage(value: unknown): ManagedBuilderImage {
  const image = value as { Id?: unknown; Size?: unknown; RepoDigests?: unknown; Os?: unknown };
  if (
    !image ||
    typeof image.Id !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(image.Id) ||
    image.Os !== 'linux' ||
    !Number.isSafeInteger(image.Size) ||
    Number(image.Size) <= 0 ||
    Number(image.Size) > 1024 ** 3 ||
    !Array.isArray(image.RepoDigests)
  )
    throw new UnsupportedManagedBuild('managed_buildkit_unsupported_unverified_installed_image');
  const source = image.RepoDigests.find(
    (digest): digest is string =>
      typeof digest === 'string' &&
      /^(?:docker\.io\/)?moby\/buildkit@sha256:[a-f0-9]{64}$/.test(digest),
  );
  if (!source)
    throw new UnsupportedManagedBuild('managed_buildkit_unsupported_unverified_installed_image');
  return { id: image.Id, source: source.replace(/^docker\.io\//, ''), bytes: Number(image.Size) };
}
/** Read-only local-engine prerequisite; never pulls a mutable tag or forwards config to a solve. */
export async function installedManagedBuilderImage(
  cwd: string,
  reference: string,
  execution: DockerExecution,
): Promise<ManagedBuilderImage> {
  const text = await managedCacheCommand(execution.docker, ['image', 'inspect', reference], {
    cwd,
    env: execution.env,
    maxOutput: 128 * 1024,
  }).catch((error) => {
    throw new UnsupportedManagedBuild('managed_buildkit_unsupported_installed_image_prerequisite', {
      cause: error,
    });
  });
  const values = JSON.parse(text) as unknown;
  if (!Array.isArray(values) || values.length !== 1)
    throw new UnsupportedManagedBuild('managed_buildkit_unsupported_unverified_installed_image');
  return verifiedManagedBuilderImage(values[0]);
}
/** Plan acquisition before admission; public registry expanded size remains explicitly estimated. */
export async function plannedManagedBuilderImage(
  cwd: string,
  pinnedReference?: string,
  client?: ManagedDockerClient,
): Promise<ManagedBuilderImage> {
  if (pinnedReference) {
    if (!client) throw new UnsupportedManagedBuild('managed_buildkit_client_binding_required');
    return installedManagedBuilderImage(cwd, pinnedReference, {
      docker: client.docker,
      env: observedDockerEnvironment(client),
    });
  }
  return resolveOfficialBuilderImage();
}
/** Exclusive admitted builder fence only. Caller supplies the verified isolated client; no ambient fallback. */
export async function provisionManagedBuilderImage(
  cwd: string,
  plan: ManagedBuilderImage,
  effect: () => void,
  settled: () => void,
  execution: DockerExecution,
) {
  if (
    !/^moby\/buildkit@sha256:[a-f0-9]{64}$/.test(plan.source) ||
    !/^sha256:[a-f0-9]{64}$/.test(plan.id) ||
    !Number.isSafeInteger(plan.bytes) ||
    plan.bytes <= 0 ||
    plan.bytes > 1024 ** 3
  )
    throw new UnsupportedManagedBuild('managed_buildkit_image_plan_unverified');
  let image: ManagedBuilderImage | undefined;
  try {
    image = await installedManagedBuilderImage(cwd, plan.source, execution);
  } catch (error) {
    if (plan.acquisition !== 'official-registry-pinned') throw error;
  }
  if (!image) {
    await resourceExecution.getStore()?.requireCurrent();
    effect();
    await managedCacheCommand(
      execution.docker,
      ['image', 'pull', '--platform=linux/amd64', plan.source],
      {
        cwd,
        env: execution.env,
        maxOutput: 1024 * 1024,
      },
    );
    image = await installedManagedBuilderImage(cwd, plan.source, execution);
    settled();
  }
  if (image.id !== plan.id || image.source !== plan.source || image.bytes > plan.bytes)
    throw new UnsupportedManagedBuild('managed_buildkit_image_identity_or_reserve_changed');
  return image;
}
