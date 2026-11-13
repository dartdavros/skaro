import type { AppDb } from '@skaro/core';
import type { DecisionOrigin, ProjectDecision } from '../shared/project-decisions';
import type { Services } from './app-services';
import { projectDecisionProjection } from './decision-projection';
import { decisionReplyStatus } from './decision-replies';
import { canonicalC4Decisions } from './c4-decision-sources';

/** Incremental project read model. Dirty owners are read, never attached/resumed. */
export class DecisionSources {
  private readonly cache = new Map<string, Map<string, ProjectDecision[]>>();
  private readonly dirty = new Map<string, Set<string>>();
  private readonly reading = new Map<string, Promise<ProjectDecision[]>>();
  private readonly known = new Map<string, ProjectDecision>();
  private readonly services: Pick<Services, 'db' | 'runs' | 'chats' | 'c4'>;
  constructor(services: Pick<Services, 'db' | 'runs' | 'chats' | 'c4'>) {
    this.services = services;
  }
  requireProject(project: string) {
    const db = this.services.db;
    if ((db.shell.projectScope && db.shell.projectScope !== project) || !db.getProject(project))
      throw new Error('decision_project_scope_invalid');
  }
  invalidate(project: string, kind?: 'task' | 'chat', id?: string) {
    if (!kind || !id) {
      this.cache.delete(project);
      return;
    }
    const set = this.dirty.get(project) ?? new Set<string>();
    set.add(`${kind}:${id}`);
    this.dirty.set(project, set);
  }
  knownEntry(project: string, id: string, revision: string) {
    this.requireProject(project);
    const entry = this.known.get(JSON.stringify([project, id]));
    return entry?.revision === revision ? entry : undefined;
  }
  private eligible(entries: ProjectDecision[]) {
    return entries.flatMap((entry) => {
      // A committed answer wins even if a crash preceded the canonical log flush.
      if (decisionReplyStatus(this.services.db, entry)) return [];
      if (!entry.id.startsWith('coordinator:')) return [entry];
      const id = entry.id.slice('coordinator:'.length),
        db = this.services.db;
      const decision = db.coordination.decisions.get(entry.origin.projectId, id);
      const request = db.getSetting<{ expiresAt: number; policyRevision: number } | undefined>(
        `coordination.decision-action.${id}`,
        undefined,
      );
      const allowed =
        decision?.state === 'pending' &&
        request &&
        request.expiresAt > Date.now() &&
        request.policyRevision ===
          this.services.runs.incidents.policy.read(entry.origin.projectId).revision;
      return allowed ? [{ ...entry, expiresAt: request.expiresAt }] : [];
    });
  }
  list(project: string): Promise<ProjectDecision[]> {
    const pending = this.reading.get(project);
    if (pending) return pending;
    const result = this.read(project);
    this.reading.set(project, result);
    void result
      .finally(() => {
        if (this.reading.get(project) === result) this.reading.delete(project);
      })
      .catch(() => undefined);
    return result;
  }
  private async read(project: string): Promise<ProjectDecision[]> {
    this.requireProject(project);
    const records = await this.services.c4.records(project);
    let sources = this.cache.get(project);
    if (!sources) {
      sources = new Map();
      this.cache.set(project, sources);
      try {
        for (const source of [
          ...(await this.services.runs.decisionSources(project)),
          ...(await this.services.chats.decisionSources(project)),
        ])
          sources.set(
            `${source.kind}:${source.id}`,
            projectDecisionProjection([canonicalC4Decisions(source, records)]),
          );
      } catch (error) {
        this.cache.delete(project);
        throw error;
      }
    }
    const dirty = this.dirty.get(project);
    this.dirty.delete(project);
    for (const owner of dirty ?? []) {
      const separator = owner.indexOf(':'),
        kind = owner.slice(0, separator),
        id = owner.slice(separator + 1);
      const rows =
        kind === 'task'
          ? await this.services.runs.decisionSources(project, id)
          : await this.services.chats.decisionSources(project, id);
      sources.set(
        owner,
        projectDecisionProjection(rows.map((source) => canonicalC4Decisions(source, records))),
      );
    }
    const result = new Map<string, ProjectDecision>();
    for (const row of [...sources.values()].flat()) {
      const previous = result.get(row.id);
      if (previous && previous.revision !== row.revision)
        throw new Error('decision_projection_conflict');
      result.set(row.id, previous ?? row);
    }
    for (const entry of result.values()) this.known.set(JSON.stringify([project, entry.id]), entry);
    while (this.known.size > 2048) this.known.delete(this.known.keys().next().value!);
    return this.eligible([...result.values()]);
  }
  async fresh(origin: DecisionOrigin) {
    this.requireProject(origin.projectId);
    const rows =
      origin.kind === 'task'
        ? await this.services.runs.decisionSources(origin.projectId, origin.id)
        : await this.services.chats.decisionSources(origin.projectId, origin.id);
    const records = await this.services.c4.records(origin.projectId);
    return this.eligible(
      projectDecisionProjection(rows.map((source) => canonicalC4Decisions(source, records))),
    );
  }
}

export const decisionReaders = new WeakMap<AppDb, DecisionSources>();
