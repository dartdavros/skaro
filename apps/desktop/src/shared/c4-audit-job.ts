import { auditActive, type C4Audit } from './c4-audit';
import type { BackgroundJob } from './background';
export function c4AuditJob(audit: C4Audit, actionable = true): BackgroundJob {
  return {
    id: `c4-audit:${audit.id}`,
    what: 'c4.audit',
    projectId: audit.projectId,
    state: auditActive(audit.state)
      ? 'running'
      : ['error', 'conflict'].includes(audit.state)
        ? 'failed'
        : 'done',
    startedAt: audit.startedAt,
    endedAt: auditActive(audit.state) ? undefined : audit.updatedAt,
    audit,
    ...(actionable && audit.state === 'decision' ? { decisionId: audit.packageId } : {}),
  };
}
