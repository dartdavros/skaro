import { createHash } from 'node:crypto';
import {
  metadataEnum,
  metadataHash,
  metadataId,
  metadataObject,
  metadataVersion,
} from './validation.ts';

export const INCIDENT_CAUSES = [
  'dependency',
  'environment',
  'resource',
  'permission',
  'owner-decision',
  'secret',
  'rate-limit',
  'quota',
  'budget',
  'context',
  'authentication',
  'external',
  'no-progress',
] as const;
export type IncidentCause = (typeof INCIDENT_CAUSES)[number];
export interface IncidentSubscription {
  taskId: string;
  runId: string;
  inputs: string;
  intent: number;
}
/** A renewed intent replaces only that task's subscription; peers keep their own snapshots. */
export function incidentSubscribers(
  existing: IncidentSubscription[],
  current: IncidentSubscription,
): IncidentSubscription[] {
  return [...existing.filter((s) => s.taskId !== current.taskId), current];
}
export interface IncidentProtocol {
  cause: IncidentCause;
  code: string;
  resourceVersion: string;
  condition: 'environment-ready' | 'inputs-current' | 'provider-evidence' | 'owner-evidence';
  phase: 'diagnosing' | 'waiting' | 'executing' | 'verifying' | 'exhausted';
  attempts: number;
  subscriptions: IncidentSubscription[];
  decisionId?: string;
  operationId?: string;
  ownerPolicyRevision?: number;
}
export function incidentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function incidentProtocol(input: unknown): IncidentProtocol {
  const v = metadataObject(input, [
    'cause',
    'code',
    'resourceVersion',
    'condition',
    'phase',
    'attempts',
    'subscriptions',
    'decisionId',
    'operationId',
    'ownerPolicyRevision',
  ]);
  if (!Array.isArray(v.subscriptions) || v.subscriptions.length > 10000)
    throw new Error('Invalid incident subscriptions');
  return {
    cause: metadataEnum(v.cause, INCIDENT_CAUSES),
    code: metadataId(v.code),
    resourceVersion: metadataHash(v.resourceVersion),
    condition: metadataEnum(v.condition, [
      'environment-ready',
      'inputs-current',
      'provider-evidence',
      'owner-evidence',
    ] as const),
    phase: metadataEnum(v.phase, [
      'diagnosing',
      'waiting',
      'executing',
      'verifying',
      'exhausted',
    ] as const),
    attempts: metadataVersion(v.attempts),
    subscriptions: v.subscriptions.map((raw) => {
      const s = metadataObject(raw, ['taskId', 'runId', 'inputs', 'intent']);
      return {
        taskId: metadataId(s.taskId),
        runId: metadataId(s.runId),
        inputs: metadataHash(s.inputs),
        intent: metadataVersion(s.intent),
      };
    }),
    ...(v.decisionId === undefined ? {} : { decisionId: metadataId(v.decisionId) }),
    ...(v.operationId === undefined ? {} : { operationId: metadataId(v.operationId) }),
    ...(v.ownerPolicyRevision === undefined
      ? {}
      : { ownerPolicyRevision: metadataVersion(v.ownerPolicyRevision) }),
  };
}
export function incidentIdentity(
  projectId: string,
  subject: string,
  protocol: Pick<
    IncidentProtocol,
    'cause' | 'code' | 'resourceVersion' | 'condition' | 'ownerPolicyRevision'
  >,
): string {
  return incidentHash([
    projectId,
    subject,
    protocol.cause,
    protocol.code,
    protocol.resourceVersion,
    protocol.condition,
    ...(protocol.ownerPolicyRevision === undefined ? [] : [protocol.ownerPolicyRevision]),
  ]);
}
