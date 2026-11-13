import { randomUUID } from 'node:crypto';
import type { AppDb } from '@skaro/core';
import type { C4Audit } from '../shared/c4-audit';

const key = (project: string) => `c4.audit.${project}`;
export class C4AuditStore {
  private readonly db: AppDb;
  private readonly changed: (project: string) => void;
  constructor(db: AppDb, changed: (project: string) => void) {
    this.db = db;
    this.changed = changed;
  }
  read(project: string): C4Audit | undefined {
    if (
      !this.db.getProject(project) ||
      (this.db.shell.projectScope && this.db.shell.projectScope !== project)
    )
      throw new Error('Audit project is outside scope');
    return this.db.getSetting<C4Audit | undefined>(key(project), undefined, { strict: true });
  }
  begin(project: string, previous?: string) {
    const current = this.read(project);
    if (current && current.id !== previous) return current;
    if (current && !['done', 'partial', 'error', 'stopped'].includes(current.state)) return current;
    const now = Date.now();
    const next: C4Audit = {
      id: randomUUID(),
      projectId: project,
      state: 'preparing',
      startedAt: now,
      updatedAt: now,
    };
    if (!this.db.settings.compareAndSet(key(project), current, next))
      throw new Error('Audit changed during launch');
    this.db.addEvent(project, 'c4_audit_state', { audit: next });
    this.changed(project);
    return next;
  }
  update(audit: C4Audit, patch: Partial<Omit<C4Audit, 'id' | 'projectId' | 'startedAt'>>) {
    const current = this.read(audit.projectId);
    if (!current || current.id !== audit.id) throw new Error('Audit is no longer current');
    const next = { ...current, ...patch, updatedAt: current.updatedAt };
    if (JSON.stringify(next) === JSON.stringify(current)) return current;
    next.updatedAt = Math.max(Date.now(), current.updatedAt + 1);
    if (!this.db.settings.compareAndSet(key(audit.projectId), current, next))
      throw new Error('Audit changed during update');
    this.db.addEvent(audit.projectId, 'c4_audit_state', { audit: next });
    this.changed(audit.projectId);
    return next;
  }
  forChat(project: string, chat: string) {
    const audit = this.read(project);
    return audit?.chatId === chat ? audit : undefined;
  }
}
