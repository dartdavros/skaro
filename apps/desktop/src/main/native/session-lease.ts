import type { NativeAdmissions } from './admissions';

export interface NativeSessionLeaseOwner {
  builtinAdmission?: NativeAdmissions;
  builtinClose?: () => void | Promise<void>;
}

export async function revokeNativeSession(owner: NativeSessionLeaseOwner, reason: string) {
  const lease = owner.builtinAdmission;
  try {
    if (lease) await lease.revoke(lease.admission, reason);
  } finally {
    await owner.builtinClose?.();
  }
  return lease;
}

export async function confirmNativeSessionExit(
  owner: NativeSessionLeaseOwner,
  lease?: NativeAdmissions,
) {
  if (!lease) return;
  await lease.confirmExit(lease.admission);
  if (owner.builtinAdmission === lease) {
    owner.builtinAdmission = undefined;
    owner.builtinClose = undefined;
  }
}
