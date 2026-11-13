import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import type {
  ResourceIdentity,
  ResourceOutcomeInput,
  ResourcePatch,
  ResourceRegistration,
} from './model.ts';

const object = (value: unknown): Record<string, unknown> => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error('Invalid resource record');
  return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('Unsupported resource field');
};
const text = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\0\r\n]/.test(value))
    throw new Error('Invalid resource identity or reference');
  return value;
};
const oneOf = (value: unknown, choices: string[]) => {
  if (typeof value !== 'string' || !choices.includes(value))
    throw new Error('Invalid resource classification');
};
const positive = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error('Invalid resource generation or revision');
};
const references = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid resource references');
  const entries = value.map(text);
  if (new Set(entries).size !== entries.length) throw new Error('Duplicate resource reference');
  return entries.sort();
};

export function resourceIdentity(input: unknown): ResourceIdentity {
  const value = object(input);
  keys(value, ['path', 'composeProject']);
  if (value.path === undefined && value.composeProject === undefined)
    throw new Error('A resource requires an exact path or Compose identity');
  if (value.path !== undefined && !isAbsolute(text(value.path)))
    throw new Error('Resource path must be absolute');
  return {
    ...(value.path !== undefined ? { path: resolve(text(value.path)) } : {}),
    ...(value.composeProject !== undefined ? { composeProject: text(value.composeProject) } : {}),
  };
}

function identityForKind(kind: unknown, input: unknown): ResourceIdentity {
  oneOf(kind, ['worktree', 'environment', 'cache']);
  const identity = resourceIdentity(input);
  if (kind === 'environment') {
    if (!identity.composeProject || identity.path !== undefined)
      throw new Error('An environment resource requires only an exact Compose identity');
  } else if (!identity.path || identity.composeProject !== undefined) {
    throw new Error('A filesystem resource requires only an exact path identity');
  }
  return identity;
}

/** Exact registered identities only; this helper does not infer ownership from a name/path. */
export function resourceId(input: Pick<ResourceRegistration, 'projectId' | 'kind' | 'identity'>) {
  text(input.projectId);
  const identity = identityForKind(input.kind, input.identity);
  const path =
    identity.path && (process.platform === 'win32' ? identity.path.toLowerCase() : identity.path);
  return `resource-${createHash('sha256')
    .update(
      JSON.stringify([input.projectId, input.kind, path ?? null, identity.composeProject ?? null]),
    )
    .digest('hex')}`;
}

export function resourceRegistration(input: unknown): ResourceRegistration {
  const value = object(input);
  keys(value, [
    'projectId',
    'kind',
    'identity',
    'owner',
    'purpose',
    'ownership',
    'preservation',
    'generation',
    'consumers',
    'state',
    'objectIds',
    'source',
  ]);
  text(value.projectId);
  const identity = identityForKind(value.kind, value.identity);
  const owner = object(value.owner);
  keys(owner, ['kind', 'id']);
  oneOf(owner.kind, ['project', 'task', 'integration', 'unknown']);
  text(owner.id);
  oneOf(value.purpose, ['project-dev', 'task', 'integration', 'worktree', 'cache', 'unknown']);
  oneOf(value.ownership, ['registered', 'legacy-unverified']);
  oneOf(value.preservation, ['disposable', 'reproducible', 'persistent', 'unique', 'unknown']);
  oneOf(value.state, ['available', 'retained', 'released', 'error']);
  positive(value.generation);
  if (
    value.purpose === 'project-dev' &&
    (value.preservation !== 'persistent' || owner.kind !== 'project')
  )
    throw new Error('A project dev resource requires persistent project ownership');
  if (value.ownership === 'registered' && (owner.kind === 'unknown' || value.purpose === 'unknown'))
    throw new Error('Registered ownership requires an identified owner');
  if (
    (owner.kind === 'unknown' || value.purpose === 'unknown') &&
    ['disposable', 'reproducible'].includes(String(value.preservation))
  )
    throw new Error('Unknown resources cannot acquire disposable classification');
  if (
    value.ownership === 'legacy-unverified' &&
    ['disposable', 'reproducible'].includes(String(value.preservation))
  )
    throw new Error('Unverified legacy resources cannot acquire disposable classification');
  if (!Array.isArray(value.consumers) || value.consumers.length > 10000)
    throw new Error('Invalid resource consumers');
  if (value.state === 'released' && value.consumers.length)
    throw new Error('A released resource cannot have consumers');
  const seen = new Set<string>();
  const consumers = value.consumers
    .map((input) => {
      const consumer = object(input);
      keys(consumer, ['id', 'kind', 'generation']);
      const id = text(consumer.id);
      oneOf(consumer.kind, ['agent', 'verification', 'integration', 'copy', 'preview', 'unknown']);
      positive(consumer.generation);
      if (consumer.generation !== value.generation || seen.has(id))
        throw new Error('Stale or duplicate resource consumer');
      seen.add(id);
      return { ...consumer };
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (value.source !== undefined) {
    const source = object(value.source);
    keys(source, ['declarationRevision', 'commit', 'dataVersion', 'recovery']);
    for (const [key, entry] of Object.entries(source)) {
      if (key === 'declarationRevision' && typeof entry === 'number') {
        if (!Number.isSafeInteger(entry) || entry < 0)
          throw new Error('Invalid declaration revision');
      } else text(entry);
    }
  }
  return JSON.parse(
    JSON.stringify({
      ...value,
      identity,
      owner: { ...owner },
      consumers,
      ...(value.objectIds !== undefined ? { objectIds: references(value.objectIds) } : {}),
    }),
  ) as ResourceRegistration;
}

export function resourcePatch(input: unknown): ResourcePatch {
  const value = object(input);
  keys(value, ['consumers', 'objectIds', 'source', 'state', 'generation']);
  if (!Object.keys(value).length || Object.values(value).some((entry) => entry === undefined))
    throw new Error('A resource update requires explicit values');
  return structuredClone(value) as ResourcePatch;
}

export function resourceOutcome(input: unknown): ResourceOutcomeInput {
  const value = object(input);
  keys(value, [
    'operationId',
    'resourceId',
    'generation',
    'action',
    'state',
    'reason',
    'relatedIds',
    'freedBytes',
  ]);
  text(value.operationId);
  text(value.resourceId);
  positive(value.generation);
  oneOf(value.action, ['inspect', 'migrate', 'stop', 'remove']);
  oneOf(value.state, ['observed', 'retained', 'failed', 'stopped', 'released']);
  if (typeof value.reason !== 'string' || !/^[a-z][a-z0-9_.-]{0,95}$/.test(value.reason))
    throw new Error('Resource outcome requires a machine reason code, not raw error output');
  if (
    value.freedBytes !== undefined &&
    (typeof value.freedBytes !== 'number' ||
      !Number.isSafeInteger(value.freedBytes) ||
      value.freedBytes < 0)
  )
    throw new Error('Invalid measured freed bytes');
  return structuredClone({
    ...value,
    ...(value.relatedIds !== undefined ? { relatedIds: references(value.relatedIds) } : {}),
  }) as unknown as ResourceOutcomeInput;
}
