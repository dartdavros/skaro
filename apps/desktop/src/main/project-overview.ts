import { DEFAULT_AGENT } from '@skaro/agents';
import type { AppDb } from '@skaro/core';
import type { Events, EventName, ProjectCard } from '../shared/ipc';
import type { Projects } from './projects';
import { background } from './background/client';
import { dirname } from 'node:path';
import { cachedProjectCards } from './project-card-cache';
import { logoReference } from './project-logo-reference';

/** Cached registry first; refresh and publish one project at a time, without a global barrier. */
export class ProjectOverview {
  private readonly ready: Promise<unknown>;
  private readonly checked = new Map<string, number>();
  private readonly dirty = new Set<string>();
  private readonly running = new Set<string>();
  private readonly db: AppDb;
  private readonly projects: Projects;
  private readonly publish: (card: ProjectCard) => void;
  constructor(db: AppDb, projects: Projects, publish: (card: ProjectCard) => void) {
    this.db = db;
    this.projects = projects;
    this.publish = publish;
    this.ready = background(dirname(db.filePath), 'registry.migrate').catch((error: unknown) =>
      console.error('Project card migration:', error),
    );
  }
  async query(query: import('../shared/project-catalog').ProjectQuery) {
    await this.ready;
    const result = await background(dirname(this.db.filePath), 'registry.query', query);
    this.refreshCards(result.cards);
    if (query.remember)
      this.db.setSetting(
        'ui.projects.initial',
        result.cards.slice(0, 32).map((card) => card.id),
      );
    return result;
  }
  async page(source: import('../shared/project-catalog').ProjectRange, start: number) {
    const cards = await background(dirname(this.db.filePath), 'registry.page', source, start);
    this.refreshCards(cards);
    return cards;
  }
  private refreshCards(cards: ProjectCard[]) {
    for (const card of cards)
      if (card.unloaded || Date.now() - (this.checked.get(card.id) ?? 0) > 30_000) {
        this.checked.delete(card.id);
        this.checked.set(card.id, Date.now());
        this.dirty.add(card.id);
      }
    while (this.checked.size > 512) this.checked.delete(this.checked.keys().next().value!);
    setImmediate(() => void this.ready.then(() => this.pump()));
  }
  list(): ProjectCard[] {
    const records = this.db.shell.list();
    const cached = new Map(
      cachedProjectCards(
        this.db.filePath,
        records.map((project) => project.id),
      ).map((card) => [card.id, card]),
    );
    for (const record of records) this.dirty.add(record.id);
    setImmediate(() => void this.ready.then(() => this.pump()));
    return records.map((p) => ({
      ...(cached.get(p.id) ?? {
        counts: { working: 0, needs: 0, review: 0, failed: 0, blocked: 0 },
        running: [],
        agent: DEFAULT_AGENT,
        activeAt: p.lastOpenedAt ?? p.createdAt,
        missing: false,
        unloaded: true,
      }),
      id: p.id,
      name: p.name,
      path: p.path,
      logo: logoReference(p),
      refreshing: true,
    }));
  }
  observe<E extends EventName>(event: E, payload: Events[E]): void {
    if (!['project.changed', 'task.changed', 'chats.changed'].includes(event)) return;
    const { projectId } = payload as { projectId: string };
    this.dirty.add(projectId);
    setImmediate(() => void this.ready.then(() => this.pump()));
  }
  private pump(): void {
    for (const id of this.dirty) {
      if (this.running.size >= 2) break;
      if (this.running.has(id)) continue;
      this.dirty.delete(id);
      const project = this.db.shell.get(id);
      if (!project) {
        continue;
      }
      this.running.add(id);
      this.projects.get(id);
      void background(dirname(this.db.filePath), 'overview.card', id)
        .then(async (card) => {
          await background(dirname(this.db.filePath), 'registry.card', card);
          this.publish(card);
        })
        .catch((error: unknown) => console.error(`Project overview ${id}:`, error))
        .finally(() => {
          this.running.delete(id);
          this.pump();
        });
    }
  }
}
