import { DEFAULT_AGENT } from '@skaro/agents';
import { join } from 'node:path';
import { AppDb } from '@skaro/core';
import { logoReference } from '../project-logo-reference';
import type { PayloadStore } from './payload-store';
import type { ProjectCard } from '../../shared/ipc-sessions';
import type { ProjectQuery, ProjectRange } from '../../shared/project-catalog';

/** Query results are addressed by indexed positions; UI pages never sort or clone the registry. */
export class ProjectIndex {
  private readonly store: PayloadStore;
  private initialized = false;
  constructor(store: PayloadStore) {
    this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS project_cards (
      id TEXT PRIMARY KEY,search TEXT NOT NULL,score INTEGER NOT NULL,active REAL NOT NULL,
      name_rank INTEGER NOT NULL,value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS project_card_attention ON project_cards(score DESC,active DESC,id);
      CREATE INDEX IF NOT EXISTS project_card_recent ON project_cards(active DESC,id);
      CREATE INDEX IF NOT EXISTS project_card_name ON project_cards(name_rank,id);
      CREATE TABLE IF NOT EXISTS project_queries (key TEXT PRIMARY KEY,revision INTEGER NOT NULL,count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS project_pages (key TEXT NOT NULL,revision INTEGER NOT NULL,
        position INTEGER NOT NULL,id TEXT NOT NULL,PRIMARY KEY(key,revision,position));
      CREATE INDEX IF NOT EXISTS project_page_revision ON project_pages(revision);
      CREATE TABLE IF NOT EXISTS project_index_meta (id INTEGER PRIMARY KEY,source_revision INTEGER NOT NULL,generation INTEGER NOT NULL);
      INSERT OR IGNORE INTO project_index_meta VALUES (1,-1,0)`);
  }
  private initialize(): void {
    if (this.initialized) return;
    const db = AppDb.readOnly(join(this.store.dataDir, 'skaro.db'));
    try {
      const version = db.shell.version();
      const previous = this.store.db
        .prepare('SELECT source_revision FROM project_index_meta WHERE id=1')
        .get();
      if (Number(previous?.['source_revision']) === version) {
        this.initialized = true;
        return;
      }
      const records = db.shell.list().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      const wanted = new Set(records.map((record) => record.id));
      for (let start = 0; start < records.length; start += 32)
        this.store.transaction(() =>
          records.slice(start, start + 32).forEach((record, offset) => {
            const rank = start + offset;
            const saved = this.store.db
              .prepare('SELECT value FROM project_cards WHERE id=?')
              .get(record.id);
            const cached = saved ? (JSON.parse(String(saved['value'])) as ProjectCard) : undefined;
            this.write(
              {
                counts: { working: 0, needs: 0, review: 0, failed: 0, blocked: 0 },
                running: [],
                agent: DEFAULT_AGENT,
                missing: false,
                unloaded: cached ? !!cached.unloaded : true,
                ...cached,
                id: record.id,
                name: record.name,
                path: record.path,
                logo: logoReference(record),
                activeAt: Math.max(cached?.activeAt ?? 0, record.lastOpenedAt ?? record.createdAt),
              },
              rank,
            );
          }),
        );
      for (const row of this.store.db.prepare('SELECT id FROM project_cards').all())
        if (!wanted.has(String(row['id'])))
          this.store.db.prepare('DELETE FROM project_cards WHERE id=?').run(String(row['id']));
      this.store.db.exec('DELETE FROM project_queries;');
      this.store.db
        .prepare('UPDATE project_index_meta SET source_revision=? WHERE id=1')
        .run(version);
      this.initialized = true;
    } finally {
      db.close();
    }
  }
  private write(card: ProjectCard, rank: number): void {
    const score = card.counts.needs * 10 + card.counts.review * 5 + card.counts.failed * 3;
    this.store.db
      .prepare(
        `INSERT INTO project_cards VALUES (?,?,?,?,?,?) ON CONFLICT(id)
      DO UPDATE SET search=excluded.search,score=excluded.score,active=excluded.active,
        name_rank=excluded.name_rank,value=excluded.value WHERE project_cards.value<>excluded.value OR project_cards.name_rank<>excluded.name_rank`,
      )
      .run(
        card.id,
        `${card.name} ${card.path}`.toLowerCase(),
        score,
        card.activeAt,
        rank,
        JSON.stringify(card),
      );
  }
  update(card: ProjectCard): void {
    this.initialize();
    const old = this.store.db
      .prepare('SELECT name_rank,value FROM project_cards WHERE id=?')
      .get(card.id);
    if (!old || (JSON.parse(String(old['value'])) as ProjectCard).name !== card.name) {
      this.initialized = false;
      this.initialize();
    }
    const rank = this.store.db
      .prepare('SELECT name_rank FROM project_cards WHERE id=?')
      .get(card.id);
    this.write(card, Number(rank?.['name_rank'] ?? 0));
    this.store.db.exec('DELETE FROM project_queries');
  }
  refresh(): void {
    this.initialized = false;
  }
  query(query: ProjectQuery) {
    this.initialized = false;
    this.initialize();
    const text = query.query.trim().toLowerCase();
    const key = JSON.stringify([text, query.sort]);
    let saved = this.store.db
      .prepare('SELECT revision,count FROM project_queries WHERE key=?')
      .get(key);
    if (!saved) {
      const order =
        query.sort === 'name'
          ? 'name_rank,id'
          : query.sort === 'recent'
            ? 'active DESC,id'
            : 'score DESC,active DESC,id';
      const revision = Number(
        this.store.db
          .prepare(
            'UPDATE project_index_meta SET generation=generation+1 WHERE id=1 RETURNING generation',
          )
          .get()!['generation'],
      );
      this.store.transaction(() => {
        this.store.db
          .prepare(
            `INSERT INTO project_pages SELECT ?,?,ROW_NUMBER() OVER (ORDER BY ${order})-1,id
          FROM project_cards WHERE ?='' OR instr(search,?)>0`,
          )
          .run(key, revision, text, text);
        const count = Number(
          this.store.db
            .prepare('SELECT COUNT(*) AS n FROM project_pages WHERE key=? AND revision=?')
            .get(key, revision)!['n'],
        );
        this.store.db
          .prepare('INSERT INTO project_queries VALUES (?,?,?)')
          .run(key, revision, count);
      });
      this.store.db.prepare('DELETE FROM project_queries WHERE revision<?').run(revision - 8);
      this.store.db.prepare('DELETE FROM project_pages WHERE revision<?').run(revision - 8);
      saved = this.store.db
        .prepare('SELECT revision,count FROM project_queries WHERE key=?')
        .get(key)!;
    }
    const source = { key, revision: Number(saved['revision']), count: Number(saved['count']) };
    return { source, cards: this.page(source, 0) };
  }
  page(source: ProjectRange, start: number): ProjectCard[] {
    start = Math.max(0, Math.floor(start));
    return this.store.db
      .prepare(
        `SELECT c.value FROM project_pages p JOIN project_cards c ON c.id=p.id
      WHERE p.key=? AND p.revision=? AND p.position>=? AND p.position<? ORDER BY p.position`,
      )
      .all(source.key, source.revision, start, start + 48)
      .map((row) => JSON.parse(String(row['value'])) as ProjectCard);
  }
}
