import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { ManagedBuildApproval } from '../managed-build-profile';
import type { ManagedBuildSource } from '../managed-build-source';
import { managedDockerClientFingerprint, type ManagedDockerClient } from '../managed-docker-client';
import { CACHE_VERIFICATION_OWNER_SCOPE } from './cache-verification-scope';
import {
  requireCacheVerificationSource,
  type CacheVerificationSource,
} from './cache-verification-source';

/** Owner's recorded exception: this host verifier only, never worker input or a persisted global grant. */
export const CACHE_BUILDKIT_OWNER_APPROVAL = Object.freeze({
  projectId: CACHE_VERIFICATION_OWNER_SCOPE.projectId,
  contextRoot: join(CACHE_VERIFICATION_OWNER_SCOPE.root, 'backend'),
  sourceDigest: '065f8ca56fe09e035ab1b0c831c66c478fa1bd90c621bee8cdb5cc9ad7ef5a12',
  recipeDigest: '9562759c2d8e329b866c25c2f80edc2a36cba207ff0c3ef19fa2fe48dce08b15',
  profile: 'trusted-static-single-stage-default-egress-v1',
  base: 'python:3.12-slim@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54',
  files: 756,
  bytes: 2112137,
  nodes: 848,
  dockerHost: 'npipe:////./pipe/dockerDesktopLinuxEngine',
  daemon: '04b42192-4024-4df0-bfcd-6cb463cd280e',
  clientFingerprint: '52207c0f7698277547e0de04271d2e6390ce3e716818dc4fad87991d2bfec06f',
} as const);

export function requireCacheBuildkitOptIn(env: NodeJS.ProcessEnv = process.env) {
  const owner = CACHE_BUILDKIT_OWNER_APPROVAL;
  if (
    env.SKARO_RC3_CACHE_PROJECT !== owner.projectId ||
    env.SKARO_RC3_CACHE_PHASE !== 'buildkit' ||
    env.SKARO_RC3_CACHE_SOURCE_SHA256 !== owner.sourceDigest ||
    env.SKARO_RC3_CACHE_RECIPE_SHA256 !== owner.recipeDigest
  )
    throw new Error('cache_buildkit_exact_owner_opt_in_required');
}

export function requireApprovedBuildkitSnapshot(snapshot: ManagedBuildSource) {
  const owner = CACHE_BUILDKIT_OWNER_APPROVAL;
  if (
    snapshot.sourceDigest !== owner.sourceDigest ||
    snapshot.recipeDigest !== owner.recipeDigest ||
    snapshot.base !== owner.base ||
    snapshot.files.length !== owner.files ||
    snapshot.bytes !== owner.bytes ||
    snapshot.nodes !== owner.nodes
  )
    throw new Error('cache_buildkit_owner_approved_snapshot_changed');
}

export function requireApprovedBuildkitClient(client: ManagedDockerClient) {
  const owner = CACHE_BUILDKIT_OWNER_APPROVAL;
  if (
    client.host !== owner.dockerHost ||
    client.daemon !== owner.daemon ||
    managedDockerClientFingerprint(client) !== owner.clientFingerprint
  )
    throw new Error('cache_buildkit_owner_approved_docker_client_changed');
}

export async function approveCacheBuildkitSource(
  source: CacheVerificationSource,
  snapshot: ManagedBuildSource,
): Promise<Readonly<ManagedBuildApproval>> {
  requireCacheBuildkitOptIn();
  requireCacheVerificationSource(source);
  await source.requireCurrent();
  requireApprovedBuildkitSnapshot(snapshot);
  const owner = CACHE_BUILDKIT_OWNER_APPROVAL;
  const contextRoot = await realpath(join(source.root, 'backend'));
  if (source.projectId !== owner.projectId || contextRoot !== (await realpath(owner.contextRoot)))
    throw new Error('cache_buildkit_owner_approved_context_changed');
  return Object.freeze({
    projectId: owner.projectId,
    contextRoot,
    sourceDigest: owner.sourceDigest,
    recipeDigest: owner.recipeDigest,
    profile: owner.profile,
  });
}
