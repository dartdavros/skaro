import { createHash } from 'node:crypto';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { canonicalCachePath, hasCacheControls, readCacheFile } from './managed-cache-files';
import { managedDockerToolDigest, minimalManagedDockerEnvironment } from './managed-docker-tools';
import type { ManagedBuilder, ManagedCacheStore } from './managed-cache-store';

export interface ManagedDockerClient {
  host: string;
  daemon: string;
  docker: string;
  dockerDigest: string;
  buildx: string;
  buildxDigest: string;
}
export function managedLocalDockerHost(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 2048 &&
    !hasCacheControls(value) &&
    (/^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_.-]+$/.test(value) ||
      (/^unix:\/\/\/[A-Za-z0-9_./-]+$/.test(value) &&
        !value
          .slice(7)
          .split('/')
          .some((part) => part === '.' || part === '..')))
  );
}
export function validManagedDockerClient(value: unknown): value is ManagedDockerClient {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const tool = (key: string, name: string) =>
    typeof entry[key] === 'string' &&
    (entry[key] as string).length <= 2048 &&
    isAbsolute(entry[key] as string) &&
    !hasCacheControls(entry[key] as string) &&
    [name, `${name}.exe`].includes(basename(entry[key] as string));
  return (
    Object.keys(entry).length === 6 &&
    Object.keys(entry).every((key) =>
      ['host', 'daemon', 'docker', 'dockerDigest', 'buildx', 'buildxDigest'].includes(key),
    ) &&
    managedLocalDockerHost(entry.host) &&
    typeof entry.daemon === 'string' &&
    entry.daemon.length > 0 &&
    entry.daemon.length <= 512 &&
    !hasCacheControls(entry.daemon) &&
    tool('docker', 'docker') &&
    tool('buildx', 'docker-buildx') &&
    typeof entry.dockerDigest === 'string' &&
    /^[a-f0-9]{64}$/.test(entry.dockerDigest) &&
    typeof entry.buildxDigest === 'string' &&
    /^[a-f0-9]{64}$/.test(entry.buildxDigest)
  );
}
export function managedDockerClientFingerprint(client: ManagedDockerClient) {
  if (!validManagedDockerClient(client))
    throw new Error('managed_docker_client_binding_unverified');
  return createHash('sha256')
    .update(
      JSON.stringify([
        client.host,
        client.daemon,
        client.docker,
        client.dockerDigest,
        client.buildx,
        client.buildxDigest,
      ]),
    )
    .digest('hex');
}
export function managedDockerConfiguration(client: ManagedDockerClient) {
  managedDockerClientFingerprint(client);
  // A present empty public auth record prevents Docker's default native credential-store detection.
  return (
    JSON.stringify({
      auths: { 'https://index.docker.io/v1/': {} },
      cliPluginsExtraDirs: [dirname(client.buildx)],
    }) + '\n'
  );
}
function paths(store: ManagedCacheStore, entry: ManagedBuilder) {
  const base = store.builderPath(entry.projectId);
  return { config: join(base, 'cli-config'), home: join(base, 'cli-home') };
}
/** Creation is inside the exact admitted builder fence; an existing unknown directory is never adopted. */
export async function publishManagedDockerClient(store: ManagedCacheStore, entry: ManagedBuilder) {
  if (!entry.client) throw new Error('managed_docker_legacy_client_binding_retained');
  const directories = paths(store, entry);
  store.db.resources.cleanup.effect(entry.resourceId);
  for (const path of [directories.config, directories.home]) {
    await canonicalCachePath(store.root, path, true);
    await mkdir(path, { mode: 0o700 });
    await canonicalCachePath(store.root, path);
  }
  const path = join(directories.config, 'config.json');
  await canonicalCachePath(store.root, path, true);
  await writeFile(path, managedDockerConfiguration(entry.client), { flag: 'wx', mode: 0o600 });
}
export async function managedDockerClientEnvironment(
  store: ManagedCacheStore,
  entry: ManagedBuilder,
): Promise<NodeJS.ProcessEnv> {
  if (
    !entry.client ||
    !validManagedDockerClient(entry.client) ||
    entry.daemon !== entry.client.daemon
  )
    throw new Error('managed_docker_client_binding_unverified');
  const { config, home } = paths(store, entry);
  const bytes = (await readCacheFile(store.root, join(config, 'config.json'), 16 * 1024)).data;
  if (!bytes.equals(Buffer.from(managedDockerConfiguration(entry.client))))
    throw new Error('managed_docker_client_configuration_changed');
  await canonicalCachePath(store.root, home);
  if (!(await lstat(home)).isDirectory()) throw new Error('managed_docker_client_home_changed');
  for (const [tool, digest] of [
    [entry.client.docker, entry.client.dockerDigest],
    [entry.client.buildx, entry.client.buildxDigest],
  ])
    if ((await managedDockerToolDigest(tool!)) !== digest)
      throw new Error('managed_docker_client_tool_changed');
  return {
    ...minimalManagedDockerEnvironment(),
    HOME: home,
    USERPROFILE: home,
    TEMP: home,
    TMP: home,
    DOCKER_HOST: entry.client.host,
    DOCKER_CONFIG: config,
    BUILDX_CONFIG: join(store.builderPath(entry.projectId), 'buildx'),
    BUILDX_BUILDER: entry.name,
    BUILDX_NO_DEFAULT_ATTESTATIONS: '1',
  };
}
