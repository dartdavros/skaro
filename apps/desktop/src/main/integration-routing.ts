import type { MessageInput } from '../shared/ipc';
import type { IntegrationOperation } from './integration-model';

/** These command IDs belong to the task's own execution intent and native session. */
export function isTaskContinuationInput(input: MessageInput): boolean {
  return (
    input.internal === true &&
    (input.commandId?.startsWith('continue-') === true ||
      input.commandId?.startsWith('diagnose-incident-') === true)
  );
}

export function integrationHoldsTask(
  operation: Pick<
    IntegrationOperation,
    'taskId' | 'results' | 'purpose' | 'state' | 'worker' | 'executor'
  >,
  taskId: string,
): boolean {
  if (operation.taskId !== taskId && !operation.results.some((result) => result.taskId === taskId))
    return false;
  if (operation.worker || operation.executor) return true;
  // A local verification candidate has its own checkout. It must revalidate its immutable
  // inputs on resumption and holds no task slot after Stop.
  if (operation.purpose === 'local' && operation.state === 'paused') return false;
  return ['preparing', 'resolving', 'verifying', 'paused', 'waiting'].includes(operation.state);
}
