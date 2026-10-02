import type { PermissionMode } from '@skaro/timeline';

interface Policy {
  approvalPolicy: 'untrusted' | 'on-request' | 'never';
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
}

/** Skaro mode → Codex approval and sandbox (architecture.md 5.4, D-28). */
export function codexPolicy(
  mode: PermissionMode,
  options: { readOnly?: boolean; sandboxVerified?: boolean } = {},
): Policy {
  if (options.readOnly) return { approvalPolicy: 'on-request', sandbox: 'read-only' };
  if (mode === 'full') return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
  if (mode === 'auto' && options.sandboxVerified)
    return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
  // "Ask", and "auto" where the sandbox does not hold: commands need approval.
  return { approvalPolicy: 'untrusted', sandbox: 'workspace-write' };
}

export function sandboxPolicy(sandbox: Policy['sandbox']): Record<string, unknown> {
  if (sandbox === 'danger-full-access') return { type: 'dangerFullAccess' };
  if (sandbox === 'read-only') return { type: 'readOnly', networkAccess: false };
  return {
    type: 'workspaceWrite',
    writableRoots: [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}
