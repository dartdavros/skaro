import type { TimelineState, TimelineEvent } from '@skaro/timeline';
import { pendingProposals } from '../../shared/feed-actions';
import type { HistorySource, HistoryView, HistoryPage } from '../../shared/history';
import type { PayloadStore } from './payload-store';
import { historyRows } from './history-rows';
import { HistorySnapshots } from './history-snapshots';
import { appendHistory } from './history-append';
import { isHistoryControl, updateHistoryControls } from './history-controls';
import { HistoryChanges } from './history-changes';
import { HistoryOrigins } from './history-origins';
import { HistoryPageVersions } from './history-page-versions';
import { readHistoryPage } from './history-page-read';
import type { HistoryOrigin } from '../../shared/history';

/** The read model is indexed independently of the agent's command model. */
export class HistoryIndex {
  private readonly store: PayloadStore;
  private readonly snapshots: HistorySnapshots;
  private readonly origins: HistoryOrigins;
  private readonly changes: HistoryChanges;
  private readonly pageVersions: HistoryPageVersions;
  constructor(store: PayloadStore, budget?: number) {
    this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS feed_views (
      owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, signature TEXT NOT NULL,
      header TEXT NOT NULL, snapshot TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS feed_ranges (
        owner TEXT NOT NULL, key TEXT NOT NULL, count INTEGER NOT NULL,
        PRIMARY KEY(owner,key));
      CREATE TABLE IF NOT EXISTS feed_blocks (
        owner TEXT NOT NULL, key TEXT NOT NULL, position INTEGER NOT NULL,
        id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(owner,key,position));
      CREATE INDEX IF NOT EXISTS feed_block_ids ON feed_blocks(owner,key,id);
      CREATE TABLE IF NOT EXISTS feed_targets (
        owner TEXT NOT NULL,id TEXT NOT NULL,key TEXT NOT NULL,position INTEGER NOT NULL,
        role TEXT NOT NULL,PRIMARY KEY(owner,id,key,position,role));`);
    this.changes = new HistoryChanges(store);
    this.snapshots = new HistorySnapshots(store, budget);
    this.origins = new HistoryOrigins(store);
    this.pageVersions = new HistoryPageVersions(store);
  }
  /** A synchronous operation owns its snapshot until persistence and presentation finish. */
  withSnapshot<T>(action: () => T): T {
    try {
      return action();
    } catch (error) {
      // A rolled-back write must never leave an advanced in-memory canonical snapshot.
      this.snapshots.clear();
      throw error;
    } finally {
      this.snapshots.trim();
    }
  }
  matches(owner: string, signature: string): HistoryView | undefined {
    const saved = this.store.db
      .prepare('SELECT revision,header FROM feed_views WHERE owner=? AND signature=?')
      .get(owner, signature);
    return saved
      ? {
          source: this.source(owner, 'root', Number(saved['revision'])),
          timeline: JSON.parse(String(saved['header'])) as TimelineState,
        }
      : undefined;
  }
  initialize(
    owner: string,
    signature: string,
    state: TimelineState,
    origins?: HistoryOrigin[],
    force = false,
  ) {
    if (origins)
      state = this.origins.prepare(owner, state, origins, force, () => {
        const previous = this.store.db
          .prepare('SELECT snapshot FROM feed_views WHERE owner=?')
          .get(owner);
        return previous
          ? this.snapshots.load(owner, String(previous['snapshot'])).state
          : undefined;
      });
    return this.publish(owner, signature, state);
  }
  controls(owner: string, origins: HistoryOrigin[], force: boolean): void {
    this.origins.replace(owner, origins, force);
  }
  private source(owner: string, key: string, revision: number): HistorySource {
    const range = this.store.db
      .prepare('SELECT count FROM feed_ranges WHERE owner=? AND key=?')
      .get(owner, key);
    if (!range) throw new Error('History range is missing');
    const items =
      key === 'root'
        ? this.store.db
            .prepare("SELECT count FROM feed_ranges WHERE owner=? AND key='items'")
            .get(owner)
        : undefined;
    return {
      owner,
      key,
      revision,
      contentRevision: this.pageVersions.read(owner, revision),
      count: Number(range['count']),
      ...(items ? { itemCount: Number(items['count']), ...this.changes.info(owner) } : {}),
    };
  }
  publish(
    owner: string,
    signature: string,
    state: TimelineState,
    changed?: Set<string>,
  ): HistoryView {
    const previous = this.store.db
      .prepare('SELECT revision FROM feed_views WHERE owner=?')
      .get(owner);
    const revision = Number(previous?.['revision'] ?? 0) + 1;
    return this.store.transaction(() => {
      this.pageVersions.advance(owner, revision);
      this.store.db.prepare('DELETE FROM feed_targets WHERE owner=?').run(owner);
      const target = this.store.db.prepare('INSERT OR IGNORE INTO feed_targets VALUES (?,?,?,?,?)');
      const ranges = new Set(['items']);
      this.store.db
        .prepare(
          `INSERT INTO feed_ranges VALUES (?,?,?) ON CONFLICT(owner,key)
        DO UPDATE SET count=excluded.count`,
        )
        .run(owner, 'items', state.items.length);
      const insert = this.store.db.prepare(`INSERT INTO feed_blocks VALUES (?,?,?,?,?)
        ON CONFLICT(owner,key,position) DO UPDATE SET id=excluded.id,value=excluded.value
        WHERE feed_blocks.value<>excluded.value OR feed_blocks.id<>excluded.id`);
      const source = historyRows(state, (key, blocks) => {
        ranges.add(key);
        this.store.db
          .prepare(
            `INSERT INTO feed_ranges VALUES (?,?,?) ON CONFLICT(owner,key)
          DO UPDATE SET count=excluded.count WHERE feed_ranges.count<>excluded.count`,
          )
          .run(owner, key, blocks.length);
        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i]!;
          insert.run(owner, key, i, block.id, JSON.stringify(block));
          if (block.type === 'row' && 'item' in block.row)
            target.run(owner, block.row.item.id, key, i, 'item');
          if (block.presentation?.replyId)
            target.run(owner, block.presentation.replyId, key, i, 'reply');
        }
        this.store.db
          .prepare('DELETE FROM feed_blocks WHERE owner=? AND key=? AND position>=?')
          .run(owner, key, blocks.length);
        // References inherit the current page revision when read, avoiding rewrites of old rows.
        return { owner, key, revision: 0, count: blocks.length };
      });
      for (const row of this.store.db
        .prepare('SELECT key FROM feed_ranges WHERE owner=?')
        .all(owner)) {
        const key = String(row['key']);
        if (!ranges.has(key)) {
          this.store.db.prepare('DELETE FROM feed_blocks WHERE owner=? AND key=?').run(owner, key);
          this.store.db.prepare('DELETE FROM feed_ranges WHERE owner=? AND key=?').run(owner, key);
        }
      }
      const tail = new Set(state.items.slice(-12).map((item) => item.id));
      const lastUser = state.items.findLast(
        (item) => item.kind === 'message' && item.role === 'user' && !item.parentId,
      );
      if (lastUser) tail.add(lastUser.id);
      const header: TimelineState = {
        ...state,
        turns: state.turns.slice(-8),
        items: [
          ...state.items.filter(
            (item) =>
              item.kind !== 'proposal' &&
              (tail.has(item.id) || item.status === 'running' || item.status === 'queued'),
          ),
          ...pendingProposals(state.items),
        ],
      };
      this.store.db
        .prepare(
          `INSERT INTO feed_views VALUES (?,?,?,?,?) ON CONFLICT(owner)
        DO UPDATE SET revision=excluded.revision,signature=excluded.signature,
        header=excluded.header,snapshot=excluded.snapshot`,
        )
        .run(
          owner,
          revision,
          signature,
          JSON.stringify(header),
          this.snapshots.save(owner, state, changed),
        );
      const changes = this.changes.replace(owner, state.items);
      return {
        source: {
          ...source,
          revision,
          contentRevision: revision,
          itemCount: state.items.length,
          ...changes,
        },
        timeline: header,
      };
    });
  }
  page(source: HistorySource, start: number, limit: number): HistoryPage {
    this.verify(source);
    source = this.source(source.owner, source.key, this.revision(source.owner));
    return readHistoryPage(this.store, source, start, limit);
  }
  changePage(source: HistorySource, start: number) {
    this.verify(source);
    return this.changes.page(source.owner, start);
  }
  find(source: HistorySource, id: string): number {
    this.verify(source);
    const exact = this.store.db
      .prepare('SELECT position FROM feed_blocks WHERE owner=? AND key=? AND id=?')
      .get(source.owner, source.key, id);
    if (exact) return Number(exact['position']);
    return -1;
  }
  private verify(source: HistorySource): void {
    this.revision(source.owner);
  }
  private revision(owner: string): number {
    const current = this.store.db
      .prepare('SELECT revision FROM feed_views WHERE owner=?')
      .get(owner);
    if (!current) throw new Error('History is not indexed');
    return Number(current['revision']);
  }
  state(source: HistorySource): TimelineState {
    this.verify(source);
    const row = this.store.db
      .prepare('SELECT snapshot FROM feed_views WHERE owner=?')
      .get(source.owner)!;
    return this.snapshots.load(source.owner, String(row['snapshot'])).state;
  }
  events(
    owner: string,
    events: TimelineEvent[],
    signature: string,
    origin?: { id: string; seq: number },
  ): HistoryView | undefined {
    const saved = this.store.db
      .prepare('SELECT revision,header,snapshot FROM feed_views WHERE owner=?')
      .get(owner);
    if (!saved) return;
    if (events.length && events.every(isHistoryControl))
      return updateHistoryControls({
        store: this.store,
        snapshots: this.snapshots,
        owner,
        signature,
        events,
        pageVersions: this.pageVersions,
        previous: {
          revision: Number(saved['revision']),
          header: String(saved['header']),
          snapshot: String(saved['snapshot']),
        },
        source: (revision) => this.source(owner, 'root', revision),
        combine: origin
          ? (state) => this.origins.apply(owner, origin.id, origin.seq, events, state)
          : undefined,
      });
    if (events.every((event) => event.t === 'item.append'))
      return appendHistory(
        this.store,
        this.snapshots,
        this.pageVersions,
        owner,
        signature,
        events,
        {
          revision: Number(saved['revision']),
          header: String(saved['header']),
          snapshot: String(saved['snapshot']),
        },
        origin ? () => this.origins.advance(owner, origin.id, origin.seq) : undefined,
      );
    const rewound = events.some((event) => event.t === 'rewound');
    if (origin && rewound) {
      const previous = this.snapshots.load(owner, String(saved['snapshot'])).state;
      return this.publish(
        owner,
        signature,
        this.origins.rewind(owner, origin.id, origin.seq, events, previous),
      );
    }
    const { state, changed } = this.snapshots.apply(owner, String(saved['snapshot']), events);
    if (origin) this.origins.apply(owner, origin.id, origin.seq, events, state);
    return this.publish(owner, signature, state, rewound ? undefined : changed);
  }
}
