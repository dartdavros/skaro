import type { IntegrationOperation } from './integration-model';

export function integrationRetirementEligible(
  op: Pick<IntegrationOperation, 'state' | 'worker' | 'executor'>,
): boolean {
  return ['applied', 'stale'].includes(op.state) && !op.worker && !op.executor;
}
