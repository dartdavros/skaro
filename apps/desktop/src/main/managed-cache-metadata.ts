import { isAbsolute } from 'node:path';
import type { ManagedArtifact, ManagedBuilder } from './managed-cache-store';
import { CACHE_BYTE_LIMIT, hasCacheControls } from './managed-cache-files';
import { validManagedDockerClient } from './managed-docker-client';
import { validExactNativeIdentity } from './managed-native-identity';

const text = (value: unknown) =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 && !hasCacheControls(value);
const integer = (value: unknown, minimum = 0) =>
  Number.isSafeInteger(value) && Number(value) >= minimum;
// Historical Stats-number records remain readable, NOT authoritative. The target guard rejects unsafe legacy IDs.
const nativeIdentifier = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
const hex = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
function rows(input: unknown): Record<string, unknown>[] {
  if (
    !Array.isArray(input) ||
    input.length > 10000 ||
    input.some((x) => !x || typeof x !== 'object' || Array.isArray(x))
  )
    throw new Error('managed_cache_metadata_invalid');
  return input as Record<string, unknown>[];
}
function consumer(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    Object.keys(entry).every((key) => ['intent', 'pid', 'birth'].includes(key)) &&
    text(entry.intent) &&
    (entry.pid === undefined || integer(entry.pid, 1)) &&
    (entry.birth === undefined || text(entry.birth))
  );
}
function common(entry: Record<string, unknown>) {
  return (
    text(entry.projectId) &&
    typeof entry.resourceId === 'string' &&
    /^resource-[a-f0-9]{64}$/.test(entry.resourceId) &&
    integer(entry.generation, 1) &&
    integer(entry.usedAt) &&
    consumer(entry.consumer)
  );
}
function installTarget(value: unknown, manager: unknown) {
  if (value === undefined) return true;
  if (manager !== 'pnpm' || !value || typeof value !== 'object' || Array.isArray(value))
    return false;
  const target = value as Record<string, unknown>;
  const exact = 'nativeIdentity' in target;
  return (
    Object.keys(target).length === (exact ? 5 : 4) &&
    Object.keys(target).every((key) =>
      ['path', 'dev', 'ino', 'birthtimeMs', ...(exact ? ['nativeIdentity'] : [])].includes(key),
    ) &&
    (!exact || validExactNativeIdentity(target.nativeIdentity)) &&
    typeof target.path === 'string' &&
    target.path.length <= 2048 &&
    isAbsolute(target.path) &&
    !hasCacheControls(target.path) &&
    nativeIdentifier(target.dev) &&
    nativeIdentifier(target.ino) &&
    typeof target.birthtimeMs === 'number' &&
    Number.isFinite(target.birthtimeMs) &&
    target.birthtimeMs >= 0
  );
}
export function artifactMetadata(input: unknown): ManagedArtifact[] {
  const values = rows(input);
  for (const entry of values) {
    if (
      !common(entry) ||
      !hex(entry.key) ||
      (entry.manager !== undefined && !['npm', 'pnpm'].includes(String(entry.manager))) ||
      (entry.expansionPolicy !== undefined &&
        (entry.manager !== 'pnpm' || entry.expansionPolicy !== 'pnpm-isolated-unique-nodes-v2')) ||
      !installTarget(entry.installTarget, entry.manager) ||
      !integer(entry.bytes) ||
      Number(entry.bytes) > CACHE_BYTE_LIMIT ||
      !['publishing', 'ready', 'using', 'deleting', 'retained'].includes(String(entry.state)) ||
      typeof entry.immutable !== 'boolean' ||
      (entry.digest !== undefined && !hex(entry.digest)) ||
      (entry.immutable && !hex(entry.digest)) ||
      (entry.state === 'ready' && !entry.immutable) ||
      !integer(entry.expandedBytes) ||
      Number(entry.expandedBytes) > 1536 * 1024 ** 2 ||
      !integer(entry.expandedFiles) ||
      Number(entry.expandedFiles) > 4096 ||
      Object.keys(entry).some(
        (key) =>
          ![
            'key',
            'manager',
            'expansionPolicy',
            'installTarget',
            'projectId',
            'resourceId',
            'generation',
            'state',
            'bytes',
            'usedAt',
            'digest',
            'immutable',
            'consumer',
            'expandedBytes',
            'expandedFiles',
          ].includes(key),
      )
    )
      throw new Error('managed_dependency_metadata_invalid');
  }
  if (
    new Set(values.map((x) => x.key)).size !== values.length ||
    new Set(values.map((x) => x.resourceId)).size !== values.length
  )
    throw new Error('managed_dependency_metadata_duplicate');
  return values as unknown as ManagedArtifact[];
}
export function builderMetadata(input: unknown): ManagedBuilder[] {
  const values = rows(input);
  for (const entry of values) {
    if (
      !common(entry) ||
      typeof entry.name !== 'string' ||
      !/^skaro-owned-[a-f0-9]{32}$/.test(entry.name) ||
      !uuid(entry.token) ||
      (entry.client !== undefined && !validManagedDockerClient(entry.client)) ||
      !['creating', 'ready', 'using', 'retained'].includes(String(entry.state)) ||
      typeof entry.policy !== 'string' ||
      entry.policy.length > 8192 ||
      (entry.bytes !== undefined &&
        (!integer(entry.bytes) || Number(entry.bytes) > Number.MAX_SAFE_INTEGER)) ||
      (entry.daemon !== undefined && !text(entry.daemon)) ||
      (entry.endpoint !== undefined && !text(entry.endpoint)) ||
      (entry.container !== undefined &&
        (typeof entry.container !== 'string' || !/^[a-f0-9]{64}$/.test(entry.container))) ||
      typeof entry.image !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/.test(entry.image) ||
      typeof entry.imageSource !== 'string' ||
      !/^moby\/buildkit@sha256:[a-f0-9]{64}$/.test(entry.imageSource) ||
      !integer(entry.imageBytes, 1) ||
      Number(entry.imageBytes) > 1024 ** 3 ||
      (['ready', 'using'].includes(String(entry.state)) &&
        (!entry.daemon || !entry.endpoint || !entry.container || !entry.image)) ||
      Object.keys(entry).some(
        (key) =>
          ![
            'projectId',
            'name',
            'token',
            'resourceId',
            'generation',
            'state',
            'daemon',
            'container',
            'image',
            'imageSource',
            'imageBytes',
            'client',
            'endpoint',
            'bytes',
            'usedAt',
            'policy',
            'consumer',
          ].includes(key),
      )
    )
      throw new Error('managed_builder_metadata_invalid');
  }
  for (const key of ['projectId', 'name', 'resourceId'])
    if (new Set(values.map((x) => x[key])).size !== values.length)
      throw new Error('managed_builder_metadata_duplicate');
  return values as unknown as ManagedBuilder[];
}

/** ESRCH is the only recovery proof of absence. EPERM/inspection failure/recycled PID retain. */
export function cacheProcessAbsent(pid: number): boolean {
  if (!integer(pid, 1)) throw new Error('managed_cache_process_invalid');
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    throw error;
  }
}
