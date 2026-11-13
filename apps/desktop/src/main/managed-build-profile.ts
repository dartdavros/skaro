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
export const managedRunResourceArguments = () => [
  '--resource=memory=512m',
  '--resource=memory-swap=512m',
  '--resource=cpu-quota=100000',
  '--resource=cpu-period=100000',
];

/** Inspect the built-in frontend's actual generated LLB, since older frontends silently omit unsupported limits. */
export function verifyManagedRunPlan(value: unknown, expectedRuns: number) {
  const result = value as {
    def?: Record<
      string,
      {
        exec?: {
          network?: string;
          security?: string;
        };
      }
    >;
    metadata?: Record<
      string,
      {
        caps?: Record<string, boolean>;
        linux_resources?: {
          memory?: unknown;
          memorySwap?: unknown;
          cpuQuota?: unknown;
          cpuPeriod?: unknown;
        };
      }
    >;
  };
  if (!result?.def || !result.metadata)
    unsupportedManagedBuild('run_resources_capability_unverified');
  let runs = 0;
  const verified: {
    vertex: string;
    memory: number;
    memorySwap: number;
    cpuQuota: number;
    cpuPeriod: number;
  }[] = [];
  const exact = (value: unknown, expected: number) =>
    (typeof value === 'number' && Number.isSafeInteger(value) && value === expected) ||
    (typeof value === 'string' &&
      value.length <= 20 &&
      /^[0-9]+$/.test(value) &&
      BigInt(value) === BigInt(expected));
  for (const [digest, op] of Object.entries(result.def)) {
    if (!op.exec) continue;
    runs++;
    // convertllb serializes llb.OpMetadata with encoding/json, not ExecOp.Meta/protojson.
    const resources = result.metadata[digest]?.linux_resources;
    if (
      !resources ||
      !exact(resources.memory, 512 * 1024 ** 2) ||
      !exact(resources.memorySwap, 512 * 1024 ** 2) ||
      !exact(resources.cpuQuota, 100000) ||
      !exact(resources.cpuPeriod, 100000) ||
      result.metadata[digest]?.caps?.['exec.meta.linux.resources'] !== true ||
      (op.exec.network && op.exec.network !== 'UNSET') ||
      (op.exec.security && op.exec.security !== 'SANDBOX')
    )
      unsupportedManagedBuild('run_resources_capability_unverified');
    verified.push({
      vertex: digest,
      memory: Number(resources.memory),
      memorySwap: Number(resources.memorySwap),
      cpuQuota: Number(resources.cpuQuota),
      cpuPeriod: Number(resources.cpuPeriod),
    });
  }
  if (runs !== expectedRuns)
    unsupportedManagedBuild('unexpected_inherited_exec_or_missing_resources');
  return verified;
}
export function verifyManagedBuildHost(value: unknown) {
  const host = value as {
    OSType?: string;
    Architecture?: string;
    CgroupVersion?: string;
    MemoryLimit?: boolean;
    SwapLimit?: boolean;
    CpuCfsQuota?: boolean;
    CpuCfsPeriod?: boolean;
  };
  if (
    !host ||
    host.OSType !== 'linux' ||
    !['amd64', 'x86_64'].includes(host.Architecture ?? '') ||
    host.CgroupVersion !== '2' ||
    host.MemoryLimit !== true ||
    host.SwapLimit !== true ||
    host.CpuCfsQuota !== true ||
    host.CpuCfsPeriod !== true
  )
    unsupportedManagedBuild('linux_cgroup_v2_resource_capabilities_required');
}
