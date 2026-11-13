import { createHash } from 'node:crypto';
import { UnsupportedManagedBuild } from './managed-build-recipe';

export const MANAGED_BUILDER_IMAGE_RESERVE = 1024 ** 3;
const digest = (value: Buffer) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
interface RegistryManifest {
  schemaVersion?: number;
  config?: { digest?: string };
  manifests?: {
    digest?: string;
    platform?: { os?: string; architecture?: string; variant?: string };
  }[];
}
/** Public official registry only. No Docker config credentials, mutable-image adoption or Engine effects. */
export async function resolveOfficialBuilderImage() {
  const auth = await fetch(
    'https://auth.docker.io/token?service=registry.docker.io&scope=repository:moby/buildkit:pull',
    { signal: AbortSignal.timeout(30_000), redirect: 'error' },
  );
  if (!auth.ok) throw new UnsupportedManagedBuild('managed_buildkit_registry_identity_unavailable');
  const { token } = (await auth.json()) as { token?: unknown };
  if (typeof token !== 'string' || token.length > 16384)
    throw new UnsupportedManagedBuild('managed_buildkit_registry_identity_unavailable');
  async function manifest(reference: string, expected?: string) {
    const response = await fetch(
      `https://registry-1.docker.io/v2/moby/buildkit/manifests/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept:
            'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
        },
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      },
    );
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 128 * 1024)
      throw new UnsupportedManagedBuild('managed_buildkit_registry_manifest_unavailable');
    const reader = response.body?.getReader();
    if (!reader)
      throw new UnsupportedManagedBuild('managed_buildkit_registry_manifest_unavailable');
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.length;
        if (size > 128 * 1024)
          throw new UnsupportedManagedBuild('managed_buildkit_registry_manifest_unavailable');
        chunks.push(Buffer.from(result.value));
      }
    } finally {
      await reader.cancel();
    }
    const bytes = Buffer.concat(chunks),
      actual = digest(bytes);
    if (
      (expected && actual !== expected) ||
      response.headers.get('docker-content-digest') !== actual
    )
      throw new UnsupportedManagedBuild('managed_buildkit_registry_digest_unverified');
    const value = JSON.parse(bytes.toString('utf8')) as RegistryManifest;
    if (value.schemaVersion !== 2)
      throw new UnsupportedManagedBuild('managed_buildkit_registry_manifest_unsupported');
    return { value, digest: actual };
  }
  const index = await manifest('buildx-stable-1');
  let selected = index;
  if (index.value.manifests) {
    const platform = index.value.manifests.filter(
      (item) =>
        item.platform?.os === 'linux' &&
        item.platform.architecture === 'amd64' &&
        !item.platform.variant,
    );
    if (platform.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(platform[0]!.digest ?? ''))
      throw new UnsupportedManagedBuild('managed_buildkit_registry_platform_unverified');
    selected = await manifest(platform[0]!.digest!, platform[0]!.digest);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(selected.value.config?.digest ?? ''))
    throw new UnsupportedManagedBuild('managed_buildkit_registry_config_unverified');
  return {
    id: selected.value.config!.digest!,
    source: `moby/buildkit@${selected.digest}`,
    bytes: MANAGED_BUILDER_IMAGE_RESERVE,
    acquisition: 'official-registry-pinned' as const,
    sizeKnowledge: 'conservative-expanded-estimate' as const,
  };
}
