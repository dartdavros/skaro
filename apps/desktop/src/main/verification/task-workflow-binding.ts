import type { BuiltinVerificationDependency } from '@skaro/timeline';
import { TASK_WORKFLOW_HASH, type TaskWorkflowPacket } from './task-workflow-packet';
import type { requireTaskWorkflowBudget, requireTaskWorkflowStep } from './task-workflow-budget';

/** Explicitly selected CLI grant; never available to ordinary task/chat launches. */
export interface WorkflowModelBinding {
  hash: string;
  requireBudget: typeof requireTaskWorkflowBudget;
  requireStep: typeof requireTaskWorkflowStep;
  dependencies: BuiltinVerificationDependency[];
}

export const workflowOwnerInput = (
  packet: TaskWorkflowPacket,
  review: number | boolean = false,
  runId?: string,
  hash = TASK_WORKFLOW_HASH,
) => ({
  commandId: `workflow-${hash.slice(0, 32)}-t006${review ? '-review' + (Number(review) > 1 ? '-' + review : '') : ''}${runId ? '-' + runId : ''}`,
  text: packet.wireComposition.ownerMessages[review ? 1 : 0]!,
});
