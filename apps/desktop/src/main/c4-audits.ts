import type { AppDb } from '@skaro/core';
import type { EventName, Events } from '../shared/ipc';
import { auditCanStop, type C4Audit } from '../shared/c4-audit';
import type { C4Service } from './c4-service';
import type { ChatSessions } from './chats';
import type { Projects } from './projects';
import { C4AuditStore } from './c4-audit-store';
import { c4AuditSnapshot, verifyAuditConclusion } from './c4-audit-snapshot';
import {
  auditEndKey,
  auditReceiptKey,
  reconcileC4Audit,
  type AuditReceipt,
} from './c4-audit-status';
import { recoverC4Operations } from './c4-audit-migration';
import { startC4Audit } from './c4-audit-launch';
import { recoverC4AuditProcesses } from './c4-audit-process-recovery';

export class C4Audits {
  readonly store: C4AuditStore;
  private readonly starting = new Map<string, Promise<C4Audit>>();
  private readonly refreshing = new Map<string, Promise<C4Audit | undefined>>();
  private closing = false;
  private recovery?: Promise<void>;
  private readonly db: AppDb;
  private readonly projects: Projects;
  private readonly chats: ChatSessions;
  private readonly c4: C4Service;
  constructor(
    db: AppDb,
    projects: Projects,
    chats: ChatSessions,
    c4: C4Service,
    emit: <E extends EventName>(name: E, value: Events[E]) => void,
  ) {
    this.db = db;
    this.projects = projects;
    this.chats = chats;
    this.c4 = c4;
    this.store = new C4AuditStore(db, (projectId) => emit('c4.auditChanged', { projectId }));
  }
  start(project: string, previous?: string): Promise<C4Audit> {
    const existing = this.starting.get(project);
    if (existing) return existing;
    const work = this.recover().then(async () => {
      await recoverC4AuditProcesses(this.db, project);
      return startC4Audit(this.db, this.store, this.chats, () => this.closing, project, previous);
    });
    this.starting.set(project, work);
    return work.finally(() => {
      if (this.starting.get(project) === work) this.starting.delete(project);
    });
  }
  async context(project: string, chat: string) {
    const audit = this.store.forChat(project, chat);
    if (!audit) return this.c4.context({ kind: 'project_chat', projectId: project, chatId: chat });
    const snapshot = await c4AuditSnapshot(this.projects.get(project).root, this.c4, project, chat);
    return {
      text: JSON.stringify({
        ...JSON.parse(snapshot.context),
        audit: {
          id: audit.id,
          fingerprint: snapshot.fingerprint,
          files: snapshot.files,
          complete: snapshot.complete,
          policy:
            'Read-only full audit. Never write files directly. Submit one material package or finish with verified source paths.',
        },
      }),
    };
  }
  async finish(project: string, chat: string, args: Record<string, unknown>) {
    const audit = this.store.forChat(project, chat);
    if (!audit || !['preparing', 'running', 'decision'].includes(audit.state))
      throw new Error('No active audit owns this chat');
    const snapshot = await c4AuditSnapshot(this.projects.get(project).root, this.c4, project, chat);
    const result = verifyAuditConclusion(snapshot, args);
    const current = this.store.forChat(project, chat);
    if (!current || current.id !== audit.id || ['stopping', 'stopped'].includes(current.state))
      throw new Error('Audit authority changed');
    this.db.setSetting(auditReceiptKey(audit.id), result);
    await this.refresh(project);
    return result;
  }
  observe<E extends EventName>(name: E, payload: Events[E]) {
    if (!this.closing && name === 'command.changed') {
      const command = payload as Events['command.changed'];
      if (command.method === 'chat.send' && ['failed', 'uncertain'].includes(command.state)) {
        const [project, chat] = command.args as [string, string];
        const audit = this.store.forChat(project, chat);
        if (
          audit &&
          !['stopped', 'stopping', 'done', 'partial', 'decision', 'applying', 'conflict'].includes(
            audit.state,
          )
        )
          this.store.update(audit, {
            state: 'error',
            error: command.error ?? 'Не удалось завершить аудит.',
          });
      }
      return;
    }
    if (this.closing || name !== 'chat.events') return;
    const event = payload as Events['chat.events'];
    const audit = this.store.forChat(event.projectId, event.chatId);
    if (!audit || audit.state === 'stopped' || audit.state === 'stopping') return;
    for (const item of event.events) {
      if (item.t === 'turn.started' && audit.state === 'preparing')
        this.store.update(audit, { state: 'running' });
      if (item.t === 'interaction.opened') this.store.update(audit, { state: 'decision' });
      if (item.t === 'interaction.closed' && !audit.packageId)
        this.store.update(audit, { state: 'running' });
      if (item.t === 'turn.completed' && !item.continuing)
        this.db.setSetting(auditEndKey(audit.id), {
          outcome: item.outcome,
          error: item.error?.message,
        });
    }
    void this.refresh(event.projectId).catch((error) =>
      console.error('C4 audit observation:', error),
    );
  }
  refresh(project: string): Promise<C4Audit | undefined> {
    const previous = this.refreshing.get(project);
    const work = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const audit = this.store.read(project);
        if (!audit?.chatId) return audit;
        const records = await this.c4.records(project, audit.chatId);
        if (!records.length && ['done', 'partial', 'error', 'stopped'].includes(audit.state))
          return audit;
        const receipt = this.db.getSetting<AuditReceipt | undefined>(
          auditReceiptKey(audit.id),
          undefined,
        );
        if (receipt && !records.length && this.db.getSetting(auditEndKey(audit.id), undefined)) {
          const snapshot = await c4AuditSnapshot(
            this.projects.get(project).root,
            this.c4,
            project,
            audit.chatId,
          );
          if (snapshot.fingerprint !== receipt.fingerprint)
            return this.store.update(audit, {
              state: 'error',
              error: 'Модель C4 изменена во время сверки. Пакет не применён.',
            });
        }
        return reconcileC4Audit(this.store, this.db, this.store.read(project)!, records);
      });
    this.refreshing.set(project, work);
    return work.finally(() => {
      if (this.refreshing.get(project) === work) this.refreshing.delete(project);
    });
  }
  async stop(project: string, id: string) {
    const audit = this.require(project, id);
    if (!auditCanStop(audit.state)) return audit;
    this.store.update(audit, { state: 'stopping' });
    try {
      await this.starting.get(project);
      const current = this.require(project, id);
      if (current.chatId) await this.chats.interrupt(project, current.chatId);
      return this.store.update(audit, { state: 'stopped', error: undefined });
    } catch (error) {
      return this.store.update(audit, { state: 'error', error: String(error) });
    }
  }
  async recheck(project: string, id: string) {
    const audit = this.require(project, id);
    if (audit.state !== 'conflict' || !audit.packageId) return audit;
    this.store.update(audit, { state: 'recovering', error: undefined });
    try {
      await this.c4.decide(project, audit.packageId, 'apply');
    } catch {
      /* Original consent and the concrete conflict remain in the package journal. */
    }
    return (await this.refresh(project))!;
  }
  private require(project: string, id: string) {
    const audit = this.store.read(project);
    if (!audit || audit.id !== id) throw new Error('Audit changed');
    return audit;
  }
  recover(): Promise<void> {
    this.recovery ??= this.recoverOnce();
    return this.recovery;
  }
  private async recoverOnce() {
    for (const project of this.db.shell.list()) {
      try {
        await recoverC4AuditProcesses(this.db, project.id);
      } catch (error) {
        // Keep the retained holdings. A fresh explicit start retries the same verified shutdown.
        this.db.addEvent(project.id, 'c4_audit_process_recovery_failed', { error: String(error) });
      }
      await recoverC4Operations(this.db, this.c4, project.id);
      const audit = await this.refresh(project.id);
      if (
        !audit ||
        !['preparing', 'running', 'resource', 'model', 'stopping', 'recovering'].includes(
          audit.state,
        )
      )
        continue;
      if (audit.chatId) await this.chats.interrupt(project.id, audit.chatId);
      this.store.update(audit, { state: 'stopped' });
    }
  }
  async close() {
    this.closing = true;
    await Promise.allSettled([...this.starting.values(), ...this.refreshing.values()]);
  }
}
