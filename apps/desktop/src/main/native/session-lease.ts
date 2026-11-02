import type { NativeAdmissions } from './admissions';

export interface NativeSessionLeaseOwner {
  builtinAdmission?: NativeAdmissions;
  builtinClose?: () => void;
}

export async function revokeNativeSession(owner: NativeSessionLeaseOwner, reason: string) {
  const lease = owner.builtinAdmission;
  try {
    owner.builtinClose?.();
  } finally {
    if (lease) await lease.revoke(lease.admission, reason);
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
