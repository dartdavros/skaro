import { AsyncLocalStorage } from 'node:async_hooks';

export interface SubmissionIdentity {
  operationId: string;
  inputHash: string;
  projectId: string;
  taskId: string;
  runId: string;
}
export const submissionContext = new AsyncLocalStorage<SubmissionIdentity>();

export function submissionIdentity(projectId: string, taskId: string) {
  const current = submissionContext.getStore();
  return current?.projectId === projectId && current.taskId === taskId ? current : undefined;
}
