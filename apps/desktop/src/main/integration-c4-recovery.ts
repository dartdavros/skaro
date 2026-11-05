import type { IntegrationOperation } from './integration-model';
import type { IntegrationService } from './integration-service';

/** Older builds checked the code successfully, then failed on stale C4 file references. */
export async function recoverVerifiedC4Candidate(
  service: IntegrationService,
  op: IntegrationOperation,
): Promise<boolean> {
  if (
    op.state !== 'failed' ||
    !op.publish ||
    !op.error ||
    op.verification?.head !== op.head ||
    !op.error.split('\n').every((line) => /^\S+: missing code path .+$/.test(line))
  )
    return false;
  try {
    // Includes unchanged Git tree, current base admission and complete publication C4 validation.
    await service.assertReady(op);
  } catch {
    return false;
  }
  op.state = 'ready';
  op.error = undefined;
  op.publishFailures = 0;
  service.save(op);
  return true;
}
