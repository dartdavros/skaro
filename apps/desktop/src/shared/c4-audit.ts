export type C4AuditState =
  | 'preparing'
  | 'running'
  | 'resource'
  | 'model'
  | 'decision'
  | 'applying'
  | 'done'
  | 'partial'
  | 'error'
  | 'conflict'
  | 'stopping'
  | 'stopped'
  | 'recovering';

export interface C4Audit {
  id: string;
  projectId: string;
  chatId?: string;
  state: C4AuditState;
  startedAt: number;
  updatedAt: number;
  packageId?: string;
  error?: string;
  result?: 'unchanged' | 'applied' | 'rejected' | 'partial';
  summary?: string;
}
export interface C4AuditMethods {
  'c4.audit': (project: string) => C4Audit | undefined;
  'c4.auditStart': (project: string, previous?: string) => C4Audit;
  'c4.auditStop': (project: string, id: string) => C4Audit;
  'c4.auditRecover': (project: string, id: string) => C4Audit;
}
export const auditActive = (state: C4AuditState) =>
  ['preparing', 'running', 'resource', 'model', 'applying', 'stopping', 'recovering'].includes(
    state,
  );
export const auditCanStop = (state: C4AuditState) =>
  ['preparing', 'running', 'resource', 'model', 'recovering'].includes(state);
