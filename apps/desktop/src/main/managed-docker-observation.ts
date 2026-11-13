import { realpath } from 'node:fs/promises';
import { managedCacheCommand, managedExecutable } from './managed-cache-command';
import {
  managedLocalDockerHost,
  validManagedDockerClient,
  type ManagedDockerClient,
} from './managed-docker-client';
import { managedDockerToolDigest, minimalManagedDockerEnvironment } from './managed-docker-tools';
import { verifyManagedBuildHost } from './managed-build-profile';

/** Existing user configuration is used for read-only discovery, never for pull/build or frozen context. */
export function observedDockerEnvironment(client?: ManagedDockerClient): NodeJS.ProcessEnv {
  const env = minimalManagedDockerEnvironment();
  for (const key of ['HOME', 'USERPROFILE', 'DOCKER_CONFIG'])
    if (process.env[key]) env[key] = process.env[key];
  if (client) env.DOCKER_HOST = client.host;
  return env;
}
async function localHost(docker: string, cwd: string, env: NodeJS.ProcessEnv) {
  if (['DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'].some((key) => process.env[key]))
    throw new Error('managed_docker_tls_or_remote_context_unsupported');
  let host: unknown;
  if (!process.env.DOCKER_CONTEXT && process.env.DOCKER_HOST) host = process.env.DOCKER_HOST;
  else {
    const name =
      process.env.DOCKER_CONTEXT ??
      (await managedCacheCommand(docker, ['context', 'show'], { cwd, env }));
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(name))
      throw new Error('managed_docker_context_unverified');
    const value = JSON.parse(
      await managedCacheCommand(docker, ['context', 'inspect', '--', name], {
        cwd,
        env,
        maxOutput: 128 * 1024,
      }),
    ) as {
      Endpoints?: { docker?: { Host?: unknown; SkipTLSVerify?: unknown } };
      TLSMaterial?: Record<string, unknown>;
    }[];
    if (
      !Array.isArray(value) ||
      value.length !== 1 ||
      value[0]?.Endpoints?.docker?.SkipTLSVerify ||
      Object.keys(value[0]?.TLSMaterial ?? {}).length
    )
      throw new Error('managed_docker_context_unverified');
    host = value[0]?.Endpoints?.docker?.Host;
  }
  if (!managedLocalDockerHost(host) || (process.platform === 'win32') !== host.startsWith('npipe:'))
    throw new Error('managed_docker_local_endpoint_required');
  return host;
}
/** Bounded read-only plan: no images, builder containers, config writes or remote SSH/TLS connection. */
export async function observeManagedDockerClient(cwd: string): Promise<ManagedDockerClient> {
  const env = observedDockerEnvironment(),
    docker = await managedExecutable('docker', env);
  const host = await localHost(docker, cwd, env);
  const info = JSON.parse(
    await managedCacheCommand(docker, ['info', '--format', '{{json .}}'], {
      cwd,
      env: { ...env, DOCKER_HOST: host },
      maxOutput: 1024 * 1024,
    }),
  ) as {
    ID?: unknown;
    ClientInfo?: { Plugins?: { Name?: unknown; Path?: unknown; Err?: unknown }[] };
  };
  verifyManagedBuildHost(info);
  const plugins = info.ClientInfo?.Plugins?.filter(
    (plugin) => plugin.Name === 'buildx' && !plugin.Err,
  );
  if (!plugins || plugins.length !== 1 || typeof plugins[0]!.Path !== 'string')
    throw new Error('managed_docker_buildx_plugin_unverified');
  const buildx = await realpath(plugins[0]!.Path);
  const client = {
    host,
    daemon: info.ID as string,
    docker,
    dockerDigest: await managedDockerToolDigest(docker),
    buildx,
    buildxDigest: await managedDockerToolDigest(buildx),
  };
  if (!validManagedDockerClient(client))
    throw new Error('managed_docker_client_binding_unverified');
  return client;
}
