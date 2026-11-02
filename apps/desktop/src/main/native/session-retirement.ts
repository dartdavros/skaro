import { operationTimeout } from '@skaro/timeline';
import {
  revokeNativeSession,
  confirmNativeSessionExit,
  type NativeSessionLeaseOwner,
} from './session-lease';

/** A failed host closer cannot skip native process cleanup or the independently verified exit. */
export async function retireNativeSession(
  owner: NativeSessionLeaseOwner,
  reason: string,
  cleanup: () => Promise<void>,
) {
  const lease = owner.builtinAdmission;
  const errors: unknown[] = [];
  try {
    await operationTimeout(
      revokeNativeSession(owner, reason),
      10000,
      'Native host close deadline exceeded',
    );
  } catch (error) {
    errors.push(error);
  }
  try {
    await cleanup();
  } catch (error) {
    errors.push(error);
  }
  try {
    await confirmNativeSessionExit(owner, lease);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'Native session shutdown was not confirmed');
}
