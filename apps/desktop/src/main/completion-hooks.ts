import type { TaskRunDeps } from './task-run-model';
import type { CompletionOperation } from './completion-store';
import type { IntegrationService } from './integration-service';

export interface CompletionHooks {
  integrations: IntegrationService;
  deps: Pick<TaskRunDeps, 'db' | 'projects' | 'emit'>;
  busy: (projectId: string, taskId: string) => boolean;
  completed: (
    projectId: string,
    operation: CompletionOperation,
    unblocked: string[],
  ) => Promise<void>;
  failed: (projectId: string, taskId: string | undefined, error: string) => void;
  /** Hands a merge conflict to the agent of the task; false when the task has no run to ask. */
  conflicted?: (projectId: string, taskId: string, conflicts: string[]) => Promise<boolean>;
}
