import { incidentHash, type AppDb, type CoordinationBlocker, type ProjectCheck } from '@skaro/core';
import { assertIncidentVerification } from './incident-verification-policy';

export interface IncidentModelPlan {
  explanation: string;
  question: string;
  options: { label: string; description: string }[];
  verification?: ProjectCheck;
  verificationEnvironment?: { id: string; version: string };
  verificationSession?: import('./incident-session-verification').IncidentSessionVerification;
  resourceVersion: string;
  policyRevision: number;
  subscriptions: string;
}
export const incidentPlanKey = (id: string) => `incident.model-plan.${id}`;
export function incidentPlanVerifiable(plan: IncidentModelPlan, row: CoordinationBlocker) {
  if (!row.protocol) return false;
  const methods = [
    plan.verification,
    plan.verificationEnvironment,
    plan.verificationSession,
  ].filter(Boolean);
  if (methods.length > 1) return false;
  try {
    assertIncidentVerification(row.protocol, methods.length === 1);
    return true;
  } catch {
    return false;
  }
}
export function incidentModelPlan(db: AppDb, row: CoordinationBlocker) {
  const plan = db.getSetting<IncidentModelPlan | undefined>(incidentPlanKey(row.id), undefined, {
    strict: true,
  });
  return plan &&
    row.protocol &&
    plan.resourceVersion === row.protocol.resourceVersion &&
    plan.policyRevision === row.protocol.ownerPolicyRevision &&
    plan.subscriptions === incidentHash(row.protocol.subscriptions) &&
    incidentPlanVerifiable(plan, row)
    ? plan
    : undefined;
}
export function parseIncidentOptions(value: unknown): IncidentModelPlan['options'] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3)
    throw new Error('Provide two or three concrete resolution options with consequences');
  const options = value.map((option) => {
    if (
      typeof option?.label !== 'string' ||
      !option.label.trim() ||
      option.label.length > 200 ||
      typeof option.description !== 'string' ||
      !option.description.trim() ||
      option.description.length > 2000
    )
      throw new Error('Each resolution option requires an action and its consequences');
    return { label: option.label.trim(), description: option.description.trim() };
  });
  if (new Set(options.map((o) => o.label)).size !== options.length)
    throw new Error('Resolution options must differ');
  return options;
}
export const incidentDiagnosisId = (row: CoordinationBlocker) =>
  `diagnose-incident-${incidentHash(['checkable-resolution-v2', row.id, row.protocol?.resourceVersion, row.protocol?.ownerPolicyRevision, row.protocol?.subscriptions])}`;
