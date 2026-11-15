import { resolve } from 'node:path';
import type { ManagedBuildSource } from './managed-build-source';
import type { ManagedBuilderImage } from './managed-buildkit-image';
import { unsupportedManagedBuild } from './managed-build-recipe';

export interface ManagedBuildApproval {
  projectId: string;
  contextRoot: string;
  sourceDigest: string;
  recipeDigest: string;
  profile: 'trusted-static-single-stage-default-egress-v1';
}
/** Host-only approval argument. It is deliberately absent from worker tool inputs. */
export function managedBuildNetwork(
  projectId: string,
  cwd: string,
  source: ManagedBuildSource,
  approval?: ManagedBuildApproval,
): 'none' | 'default' {
  if (source.base === 'scratch') return 'none';
  if (
    !approval ||
    approval.projectId !== projectId ||
    resolve(approval.contextRoot) !== resolve(cwd) ||
    approval.sourceDigest !== source.sourceDigest ||
    approval.recipeDigest !== source.recipeDigest ||
    approval.profile !== 'trusted-static-single-stage-default-egress-v1'
  )
    unsupportedManagedBuild('host_approved_exact_source_profile_required');
  return 'default'; // Standard egress is NOT a public-domain allowlist or a LAN-denial firewall.
}
/** Admission estimates, not an arbitrary-RUN mathematical peak-disk/decompression guarantee. */
export function managedBuildEstimate(
  source: ManagedBuildSource,
  image: ManagedBuilderImage,
  idleCacheBytes: number,
) {
  if (
    ![source.bytes, image.bytes, idleCacheBytes].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  )
    unsupportedManagedBuild('cost_unknown');
  const baseExpandedBytes = source.base === 'scratch' ? 0 : 1024 ** 3;
  const runTransientBytes =
    source.base === 'scratch' ? Math.max(source.bytes * 4, 128 * 1024 ** 2) : 4 * 1024 ** 3;
  return {
    kind: 'conservative-estimate' as const,
    sourceBytes: source.bytes,
    hostContextBytes: Math.max(source.bytes * 2, 128 * 1024 ** 2),
    idleCacheBytes,
    builderImageBytes: image.bytes,
    builderImageKnowledge: image.sizeKnowledge ?? 'measured-installed',
    baseExpandedBytes,
    baseExpandedKnowledge:
      source.base === 'scratch' ? 'known-empty' : 'unknown-conservative-estimate',
    runTransientBytes,
    runPeakKnowledge:
      source.base === 'scratch'
        ? 'bounded-static-copy'
        : 'unknown-conservative-estimate-not-a-quota',
    dockerDiskBytes: idleCacheBytes + image.bytes + baseExpandedBytes + runTransientBytes,
    dockerRamBytes: source.base === 'scratch' ? 512 * 1024 ** 2 : 1024 ** 3,
    dockerCpuMillis: source.base === 'scratch' ? 1000 : 2000,
  };
}
/** Verify the actual execution graph and sandbox; Skaro adds no CPU/RAM constraints. */
export function verifyManagedRunPlan(value: unknown, expectedRuns: number) {
  const result = value as {
    def?: Record<string, { exec?: { network?: string; security?: string } }>;
  };
  if (!result?.def) unsupportedManagedBuild('run_execution_plan_unverified');
  const verified: { vertex: string }[] = [];
  for (const [vertex, op] of Object.entries(result.def)) {
    if (!op.exec) continue;
    if (
      (op.exec.network && op.exec.network !== 'UNSET') ||
      (op.exec.security && op.exec.security !== 'SANDBOX')
    )
      unsupportedManagedBuild('run_execution_plan_unverified');
    verified.push({ vertex });
  }
  if (verified.length !== expectedRuns)
    unsupportedManagedBuild('unexpected_inherited_exec_or_missing_runs');
  return verified;
}

/** This pinned builder targets Linux amd64; cgroup resource-limit capabilities are irrelevant. */
export function verifyManagedBuildHost(value: unknown) {
  const host = value as { OSType?: string; Architecture?: string };
  if (!host || host.OSType !== 'linux' || !['amd64', 'x86_64'].includes(host.Architecture ?? ''))
    unsupportedManagedBuild('linux_amd64_builder_required');
}
