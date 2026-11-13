import type { C4Audits } from './c4-audits';
import type { Handlers } from './ipc';
import type { C4AuditMethods } from '../shared/c4-audit';

export function c4AuditHandlers(audits: C4Audits): Pick<Handlers, keyof C4AuditMethods> {
  return {
    'c4.audit': (project) => audits.refresh(project),
    'c4.auditStart': (project, previous) => audits.start(project, previous),
    'c4.auditStop': (project, id) => audits.stop(project, id),
    'c4.auditRecover': (project, id) => audits.recheck(project, id),
  };
}
