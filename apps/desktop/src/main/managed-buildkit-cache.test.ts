import { expect, it } from 'vitest';
import { verifyBuildkitIdentity, buildkitGcConfiguration } from './managed-buildkit-identity';
import { buildkitUsage } from './managed-buildkit-cache';
import {
  validateManagedDockerfile,
  requireManagedScratch,
  secretBuildPath,
} from './managed-build-source';
import { verifiedManagedBuilderImage } from './managed-buildkit-image';
import type { ManagedBuilder } from './managed-cache-store';
import { builderLabels, builderVolumeName } from './managed-buildkit-policy';

it('requires exact predeclared ownership token, daemon, container/image IDs and isolated driver configuration', () => {
  const name = `skaro-owned-${'a'.repeat(32)}`,
    token = '12345678-1234-1234-1234-123456789abc';
  const image = `sha256:${'b'.repeat(64)}`,
    container = 'c'.repeat(64);
  const entry: ManagedBuilder = {
    projectId: 'p',
    name,
    token,
    resourceId: `resource-${'d'.repeat(64)}`,
    generation: 1,
    state: 'ready',
    daemon: 'daemon-id',
    container,
    image,
    imageSource: `moby/buildkit@sha256:${'a'.repeat(64)}`,
    imageBytes: 100,
    endpoint: `docker-container://${container}`,
    usedAt: 1,
    policy: '',
  };
  const builder = {
    Name: name,
    Driver: 'remote',
    Nodes: [
      {
        Name: `${name}0`,
        Endpoint: `docker-container://${container}`,
        DriverOpts: {},
      },
    ],
  };
  const observed = {
    Id: container,
    Name: `/buildx_buildkit_${name}0`,
    Image: image,
    Config: {
      Image: image,
      Env: [`SKARO_MANAGED_CACHE_TOKEN=${token}`],
      Labels: builderLabels(entry),
      Cmd: ['--config', '/buildkitd.toml'],
      Entrypoint: ['buildkitd'],
    },
    Mounts: [
      {
        Type: 'volume',
        Name: builderVolumeName(entry),
        Destination: '/var/lib/buildkit',
        RW: true,
      },
    ],
    State: { Running: false },
    HostConfig: {
      Memory: 512 * 1024 ** 2,
      MemorySwap: 512 * 1024 ** 2,
      CpuQuota: 100000,
      CpuPeriod: 100000,
      Privileged: true,
      Init: true,
      RestartPolicy: { Name: 'no' },
      NetworkMode: 'bridge',
    },
  };
  expect(verifyBuildkitIdentity(entry, 'daemon-id', builder, observed)).toMatchObject({
    container,
    running: false,
  });
  expect(
    verifyBuildkitIdentity(entry, 'daemon-id', builder, {
      ...observed,
      HostConfig: { ...observed.HostConfig, SecurityOpt: ['label=disable'] },
    }),
  ).toMatchObject({ container, running: false });
  for (const changed of [
    { ...observed, Id: 'e'.repeat(64) },
    { ...observed, Image: `sha256:${'f'.repeat(64)}` },
    { ...observed, Config: { ...observed.Config, Env: [] } },
    { ...observed, HostConfig: { ...observed.HostConfig, NetworkMode: 'host' } },
    { ...observed, HostConfig: { ...observed.HostConfig, SecurityOpt: ['seccomp=unconfined'] } },
    {
      ...observed,
      HostConfig: { ...observed.HostConfig, SecurityOpt: ['label=disable', 'apparmor=unconfined'] },
    },
    {
      ...observed,
      HostConfig: { ...observed.HostConfig, RestartPolicy: { Name: 'unless-stopped' } },
    },
    {
      ...observed,
      Mounts: [
        ...observed.Mounts,
        { Type: 'bind', Name: 'foreign', Destination: '/host', RW: true },
      ],
    },
  ])
    expect(() => verifyBuildkitIdentity(entry, 'daemon-id', builder, changed)).toThrow(
      'identity_unverified',
    );
  expect(() => verifyBuildkitIdentity(entry, 'other-daemon', builder, observed)).toThrow(
    'identity_unverified',
  );
  expect(() =>
    verifyBuildkitIdentity(entry, 'daemon-id', { ...builder, Driver: 'docker' }, observed),
  ).toThrow('identity_unverified');
  for (const changes of [
    { Flags: ['--allow-insecure-entitlement=network.host'] },
    { Files: { 'unapproved.toml': 'encoded-config' } },
  ])
    expect(() =>
      verifyBuildkitIdentity(
        entry,
        'daemon-id',
        {
          ...builder,
          Nodes: [{ ...builder.Nodes[0]!, ...changes }],
        },
        observed,
      ),
    ).toThrow('identity_unverified');
});

it('requires measured installed official image digest and bounded bytes, not a mutable tag assertion', () => {
  const image = {
    Id: `sha256:${'a'.repeat(64)}`,
    Os: 'linux',
    Size: 100,
    RepoDigests: [`moby/buildkit@sha256:${'b'.repeat(64)}`],
  };
  expect(verifiedManagedBuilderImage(image)).toEqual({
    id: image.Id,
    bytes: 100,
    source: image.RepoDigests[0],
  });
  expect(() =>
    verifiedManagedBuilderImage({
      ...image,
      RepoDigests: [],
      RepoTags: ['moby/buildkit:buildx-stable-1'],
    }),
  ).toThrow('unverified');
  expect(() => verifiedManagedBuilderImage({ ...image, Size: 2 * 1024 ** 3 })).toThrow(
    'unverified',
  );
});

it('has both age and byte GC boundaries and rejects unknown/inexact usage rather than zeroing it', () => {
  const config = buildkitGcConfiguration({ bytes: 2048, entries: 1, idleMs: 7 * 86400000 });
  expect(config).toContain('keepDuration = "604800s"');
  expect(config).toContain('maxUsedSpace = 2048');
  expect(config.match(/\[\[worker.oci.gcpolicy\]\]/g)).toHaveLength(2);
  expect(buildkitUsage('[{"size":100,"inUse":false},{"size":50,"inUse":true}]')).toEqual({
    bytes: 150,
    inUse: true,
  });
  expect(buildkitUsage('null')).toEqual({ bytes: 0, inUse: false });
  for (const value of [
    '',
    '{}',
    '[{"size":"150 KiB","inUse":false}]',
    '[{"size":10}]',
    '[{"Size":"150 B","Reclaimable":true}]',
    '[{"size":9007199254740993,"inUse":false}]',
  ])
    expect(() => buildkitUsage(value)).toThrow('usage_unknown');
});

it('supports a real static cache-only recipe without pretending arbitrary Dockerfiles are secret-safe', () => {
  expect(() =>
    validateManagedDockerfile(
      `FROM nginx@sha256:${'a'.repeat(64)}\nCOPY ["site/", "/usr/share/nginx/html/"]\nEXPOSE 80`,
    ),
  ).not.toThrow();
  for (const recipe of [
    'FROM nginx:latest',
    'FROM scratch\nRUN echo test',
    'FROM scratch\nARG TOKEN',
    'FROM scratch\nCOPY ["../.env", "/app/.env"]',
    '# syntax=private/frontend\nFROM scratch',
  ])
    expect(() => validateManagedDockerfile(recipe)).toThrow('unsupported');
  for (const path of ['.env', 'nested/.npmrc', 'secret.pem', 'state.sqlite', '.git/config'])
    expect(secretBuildPath(path)).toBe(true);
  expect(secretBuildPath('src/main.ts')).toBe(false);
  expect(() => requireManagedScratch('FROM scratch\nCOPY ["site/", "/app/"]')).not.toThrow();
  expect(() => requireManagedScratch('FROM scratch\nCOPY ["a", "b", "/app/"]')).toThrow(
    'copy_expansion',
  );
  expect(() =>
    requireManagedScratch('FROM scratch\nCOPY [".", "/app/"]\nCOPY [".", "/app/"]'),
  ).toThrow('copy_expansion');
  expect(() => requireManagedScratch('FROM scratch\nWORKDIR /a/b/c')).toThrow('workdir_expansion');
  expect(() => requireManagedScratch(`FROM nginx@sha256:${'a'.repeat(64)}`)).toThrow(
    'unknown_base_expansion',
  );
});
