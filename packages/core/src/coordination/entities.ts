import type { CoordinationBlockerInput, CoordinationDecisionInput } from './model.ts';
import { incidentProtocol } from './incidents.ts';
import {
  coordinationEvidence,
  coordinationRef,
  coordinationRefs,
  metadataEnum,
  metadataHash,
  metadataId,
  metadataObject,
} from './validation.ts';

export function coordinationDecision(input: unknown): CoordinationDecisionInput {
  const value = metadataObject(input, [
    'id',
    'projectId',
    'eventId',
    'operationId',
    'kind',
    'subject',
    'inputHash',
  ]);
  return {
    id: metadataId(value.id),
    projectId: metadataId(value.projectId),
    eventId: metadataId(value.eventId),
    ...(value.operationId === undefined ? {} : { operationId: metadataId(value.operationId) }),
    kind: metadataEnum(value.kind, ['question', 'approval'] as const),
    subject: coordinationRef(value.subject),
    inputHash: metadataHash(value.inputHash),
  };
}
export function coordinationBlocker(input: unknown): CoordinationBlockerInput {
  const value = metadataObject(input, [
    'protocol',
    'id',
    'projectId',
    'eventId',
    'category',
    'subject',
    'inputHash',
    'resolution',
    'subscribers',
  ]);
  return {
    ...(value.protocol === undefined ? {} : { protocol: incidentProtocol(value.protocol) }),
    id: metadataId(value.id),
    projectId: metadataId(value.projectId),
    eventId: metadataId(value.eventId),
    category: metadataEnum(value.category, [
      'dependency',
      'environment',
      'resource',
      'permission',
      'owner-decision',
      'secret',
      'quota',
      'budget',
      'authentication',
      'external',
      'no-progress',
    ] as const),
    subject: coordinationRef(value.subject),
    inputHash: metadataHash(value.inputHash),
    resolution: coordinationEvidence(value.resolution),
    subscribers: coordinationRefs(value.subscribers),
  };
}
