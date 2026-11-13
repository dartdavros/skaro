import type {
  CoordinationEvidence,
  CoordinationEventInput,
  CoordinationIntentInput,
  CoordinationOperationInput,
  CoordinationRef,
  CoordinationRequest,
  CoordinationSource,
} from './model.ts';

export function metadataObject(input: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw new Error('Invalid coordination metadata');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('Unsupported coordination metadata field');
  return value;
}
export function metadataId(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || input.length > 4096 || /[\0\r\n]/.test(input))
    throw new Error('Invalid coordination identity');
  return input;
}
export function metadataCode(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-z][a-z0-9_.-]{0,95}$/.test(input))
    throw new Error('Invalid coordination code');
  return input;
}
export function metadataHash(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-f0-9]{64}$/.test(input))
    throw new Error('Invalid coordination fingerprint');
  return input;
}
export function metadataVersion(input: unknown, minimum = 0): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < minimum)
    throw new Error('Invalid coordination version');
  return input;
}
export function metadataEnum<T extends string>(input: unknown, values: readonly T[]): T {
  if (typeof input !== 'string' || !values.includes(input as T))
    throw new Error('Invalid coordination classification');
  return input as T;
}
export function coordinationRef(input: unknown): CoordinationRef {
  const value = metadataObject(input, ['kind', 'id', 'version']);
  const kind = metadataEnum(value.kind, [
    'command',
    'task',
    'chat',
    'run',
    'integration',
    'resource',
    'document',
    'decision',
    'blocker',
  ] as const);
  return {
    kind,
    id: metadataId(value.id),
    ...(value.version === undefined
      ? {}
      : {
          version:
            typeof value.version === 'number'
              ? metadataVersion(value.version)
              : metadataId(value.version),
        }),
  };
}
export function coordinationRefs(input: unknown): CoordinationRef[] {
  if (!Array.isArray(input) || input.length > 1000)
    throw new Error('Invalid coordination references');
  const values = input.map(coordinationRef);
  if (new Set(values.map((value) => JSON.stringify(value))).size !== values.length)
    throw new Error('Duplicate coordination reference');
  return values;
}
function source(input: unknown): CoordinationSource {
  const value = metadataObject(input, ['kind', 'id']);
  return {
    kind: metadataEnum(value.kind, ['owner', 'worker', 'controller'] as const),
    id: metadataId(value.id),
  };
}
export function coordinationEvidence(input: unknown): CoordinationEvidence {
  const value = metadataObject(input, ['code', 'refs', 'fingerprint']);
  return {
    code: metadataCode(value.code),
    refs: coordinationRefs(value.refs),
    ...(value.fingerprint === undefined ? {} : { fingerprint: metadataHash(value.fingerprint) }),
  };
}
export function coordinationEvent(input: unknown): CoordinationEventInput {
  const event = metadataObject(input, [
    'id',
    'projectId',
    'kind',
    'source',
    'subject',
    'causationId',
    'inputHash',
  ]);
  return {
    id: metadataId(event.id),
    projectId: metadataId(event.projectId),
    kind: metadataCode(event.kind),
    source: source(event.source),
    subject: coordinationRef(event.subject),
    inputHash: metadataHash(event.inputHash),
    ...(event.causationId === undefined ? {} : { causationId: metadataId(event.causationId) }),
  };
}
export function coordinationIntent(input: unknown): CoordinationIntentInput {
  const intent = metadataObject(input, [
    'id',
    'projectId',
    'eventId',
    'source',
    'action',
    'subject',
    'inputHash',
  ]);
  return {
    id: metadataId(intent.id),
    projectId: metadataId(intent.projectId),
    eventId: metadataId(intent.eventId),
    source: source(intent.source),
    action: metadataCode(intent.action),
    subject: coordinationRef(intent.subject),
    inputHash: metadataHash(intent.inputHash),
  };
}
export function coordinationOperation(input: unknown): CoordinationOperationInput {
  const operation = metadataObject(input, [
    'id',
    'projectId',
    'eventId',
    'intentId',
    'idempotencyKey',
    'action',
    'subject',
    'scopeKey',
    'mode',
    'expectedVersion',
    'inputHash',
  ]);
  const mode = metadataEnum(operation.mode, [
    'mutation',
    'delivery',
    'control',
    'observation',
  ] as const);
  if (mode === 'mutation' && operation.expectedVersion === undefined)
    throw new Error('A mutation requires an expected project version');
  return {
    id: metadataId(operation.id),
    projectId: metadataId(operation.projectId),
    eventId: metadataId(operation.eventId),
    intentId: metadataId(operation.intentId),
    idempotencyKey: metadataId(operation.idempotencyKey),
    action: metadataCode(operation.action),
    subject: coordinationRef(operation.subject),
    scopeKey: metadataId(operation.scopeKey),
    mode,
    ...(operation.expectedVersion === undefined
      ? {}
      : { expectedVersion: metadataVersion(operation.expectedVersion) }),
    inputHash: metadataHash(operation.inputHash),
  };
}
export function coordinationRequest(input: unknown): CoordinationRequest {
  const value = metadataObject(input, ['event', 'intent', 'operation']);
  const result = {
    event: coordinationEvent(value.event),
    intent: coordinationIntent(value.intent),
    operation: coordinationOperation(value.operation),
  };
  if (
    result.event.projectId !== result.intent.projectId ||
    result.event.projectId !== result.operation.projectId ||
    result.event.id !== result.intent.eventId ||
    result.event.id !== result.operation.eventId ||
    result.intent.id !== result.operation.intentId ||
    result.intent.action !== result.operation.action ||
    result.intent.inputHash !== result.operation.inputHash ||
    result.event.inputHash !== result.operation.inputHash ||
    JSON.stringify(result.intent.subject) !== JSON.stringify(result.operation.subject)
  )
    throw new Error('Coordination request has inconsistent scope or causal references');
  return result;
}
