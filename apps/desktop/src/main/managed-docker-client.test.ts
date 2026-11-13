import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  managedDockerConfiguration,
  managedDockerClientFingerprint,
  managedLocalDockerHost,
  validManagedDockerClient,
  type ManagedDockerClient,
} from './managed-docker-client';
import { minimalManagedDockerEnvironment } from './managed-docker-tools';
import { observeManagedDockerClient } from './managed-docker-observation';

// Schema/environment contract metadata only; no binary, config, daemon or project is fabricated.
const client: ManagedDockerClient = {
  host: 'npipe:////./pipe/dockerDesktopLinuxEngine',
  daemon: 'daemon',
  docker: resolve('tools', process.platform === 'win32' ? 'docker.exe' : 'docker'),
  dockerDigest: 'a'.repeat(64),
  buildx: resolve('tools', process.platform === 'win32' ? 'docker-buildx.exe' : 'docker-buildx'),
  buildxDigest: 'b'.repeat(64),
};
it('binds local transport and installed tools without credential/proxy config or legacy adoption', () => {
  expect(validManagedDockerClient(client)).toBe(true);
  for (const host of [
    'tcp://127.0.0.1:2375',
    'ssh://server',
    'npipe:////server/pipe/docker',
    'unix:///a/../socket',
  ])
    expect(managedLocalDockerHost(host)).toBe(false);
  expect(validManagedDockerClient({ ...client, token: 'not-authority' })).toBe(false);
  expect(validManagedDockerClient({ ...client, buildxDigest: 'unknown' })).toBe(false);
  const config = JSON.parse(managedDockerConfiguration(client));
  expect(Object.keys(config).sort()).toEqual(['auths', 'cliPluginsExtraDirs']);
  expect(config.auths).toEqual({ 'https://index.docker.io/v1/': {} });
  expect(config.cliPluginsExtraDirs).toHaveLength(1);
  expect(managedDockerClientFingerprint({ ...client, daemon: 'other' })).not.toBe(
    managedDockerClientFingerprint(client),
  );
  expect(managedDockerClientFingerprint({ ...client, buildxDigest: 'c'.repeat(64) })).not.toBe(
    managedDockerClientFingerprint(client),
  );
});
it('constructs an allowlisted process environment instead of inheriting owner credentials or context', () => {
  const env = minimalManagedDockerEnvironment({
    PATH: resolve('tools'),
    SystemRoot: 'system',
    HOME: 'owner-home',
    USERPROFILE: 'owner-home',
    DOCKER_CONFIG: 'owner-config',
    DOCKER_CONTEXT: 'remote',
    DOCKER_HOST: 'ssh://remote',
    DOCKER_CERT_PATH: 'private-certs',
    DOCKER_TLS_VERIFY: '1',
    HTTP_PROXY: 'private-proxy',
    HTTPS_PROXY: 'private-proxy',
    ALL_PROXY: 'private-proxy',
    OPENAI_API_KEY: 'not-forwarded',
  });
  expect(env.PATH).toBe(resolve('tools'));
  expect(env.SystemRoot).toBe('system');
  for (const key of [
    'HOME',
    'USERPROFILE',
    'DOCKER_CONFIG',
    'DOCKER_CONTEXT',
    'DOCKER_HOST',
    'DOCKER_CERT_PATH',
    'DOCKER_TLS_VERIFY',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'OPENAI_API_KEY',
  ])
    expect(env[key]).toBeUndefined();
});
it.skipIf(process.env.SKARO_CACHE_DOCKER_PREFLIGHT !== '1')(
  'observes the actual local Docker endpoint and installed binaries without provisioning',
  async () => {
    const actual = await observeManagedDockerClient(resolve('.'));
    expect(validManagedDockerClient(actual)).toBe(true);
    expect(actual.dockerDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(actual.buildxDigest).toMatch(/^[a-f0-9]{64}$/);
    console.info('Actual Docker read-only binding', {
      host: actual.host,
      daemon: actual.daemon,
      fingerprint: managedDockerClientFingerprint(actual),
    });
  },
  120000,
);
