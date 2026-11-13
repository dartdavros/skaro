import type { AppDb } from '@skaro/core';
import type { ChatEngine } from './chat-engine';
import { C4AuditStore } from './c4-audit-store';

export const isAuditChat = (db: AppDb, chat: string) =>
  !!db.getSetting(`c4.audit.chat.${chat}`, undefined);
export const auditToolsAllowed = new Set([
  'get_c4_context',
  'get_project_context',
  'read_project_memory',
  'read_project_incidents',
  'read_chat_history',
  'propose_c4',
  'finish_c4_audit',
]);
export function auditAdmission(ctx: ChatEngine, project: string, chat: string) {
  if (!isAuditChat(ctx.deps.db, chat)) return undefined;
  const store = new C4AuditStore(ctx.deps.db, (projectId) =>
    ctx.deps.emit('c4.auditChanged', { projectId }),
  );
  return (state: 'resource' | 'model' | 'running') => {
    const current = store.forChat(project, chat);
    if (current && ['preparing', 'resource', 'model', 'running'].includes(current.state))
      store.update(current, { state });
  };
}
