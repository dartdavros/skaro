import type { AppDb } from '@skaro/core';
import type { ManagedCacheStore } from '../managed-cache-store';
import {
  CREATED_KEY,
  CREATED_INTENT,
  inspectCreatedBuildkit,
} from './cache-buildkit-created-inspection';
import { CREATED_EVIDENCE, createdFailedProof } from './cache-buildkit-created-journal';
import {
  STOPPED_KEY,
  STOPPED_INTENT,
  STOPPED_EVIDENCE,
  stoppedFailedProof,
  inspectStoppedBuildkit,
} from './cache-buildkit-stopped-journal';
import {
  USAGE_KEY,
  USAGE_INTENT,
  usageFailedProof,
  inspectUsageStoppedBuildkit,
} from './cache-buildkit-usage-journal';

export interface BuildkitReconciliationCase {
  key: string;
  intentId: string;
  evidence: string;
  kind: 'created' | 'stopped';
  failedProof(data: string, db: AppDb): ReturnType<typeof stoppedFailedProof>;
  inspect(store: ManagedCacheStore): ReturnType<typeof inspectCreatedBuildkit>;
}
export const createdBuildkitCase: BuildkitReconciliationCase = Object.freeze({
  key: CREATED_KEY,
  intentId: CREATED_INTENT,
  evidence: CREATED_EVIDENCE,
  kind: 'created',
  failedProof: createdFailedProof,
  inspect: inspectCreatedBuildkit,
});
export const stoppedBuildkitCase: BuildkitReconciliationCase = Object.freeze({
  key: STOPPED_KEY,
  intentId: STOPPED_INTENT,
  evidence: STOPPED_EVIDENCE,
  kind: 'stopped',
  failedProof: stoppedFailedProof,
  inspect: inspectStoppedBuildkit,
});
export const usageBuildkitCase: BuildkitReconciliationCase = Object.freeze({
  key: USAGE_KEY,
  intentId: USAGE_INTENT,
  evidence: STOPPED_EVIDENCE,
  kind: 'stopped',
  failedProof: usageFailedProof,
  inspect: inspectUsageStoppedBuildkit,
});
