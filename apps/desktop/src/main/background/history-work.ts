import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { join } from 'node:path';
import { AttachmentStore } from '@skaro/core';
import {
  Timeline,
  architecturePresentation,
  type TimelineEvent,
  type TimelineState,
} from '@skaro/timeline';
import { replayHistory } from './history-replay';
import type { PayloadStore } from './payload-store';
import type { ProposalItem } from './protocol';

interface Snapshot {
  timeline: TimelineState;
  seq: number;
  segments: number;
}
/** Stream the actual log off the UI threads; reuse a verified persistent projection on reopen. */
export function historyWork(store: PayloadStore) {
  store.db.exec(
    `CREATE TABLE IF NOT EXISTS histories (path TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, snapshot TEXT NOT NULL)`,
  );
  const attachments = new AttachmentStore(join(store.dataDir, 'attachments'));
  return async (
    path: string,
    startedAt: number,
    agent: string,
    _projectId: string,
    required = false,
  ): Promise<Snapshot> => {
    const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' && !required) return undefined;
      throw error;
    });
    if (!info) return { timeline: new Timeline().state, seq: 0, segments: 0 };
    const fingerprint = `v3:${agent}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    const cached = store.db
      .prepare('SELECT snapshot FROM histories WHERE path=? AND fingerprint=?')
      .get(path, fingerprint);
    if (cached) return JSON.parse(String(cached['snapshot'])) as Snapshot;
    let seq = 0;
    const timeline = new Timeline();
    const compact = new Map<string, ProposalItem>();
    let proposals: DatabaseSync | undefined;
    let metadata: StatementSync | undefined;
    const workspace = join(store.dataDir, 'workspace.db');
    const emit = (event: TimelineEvent) => {
      if (
        event.t === 'item.upsert' &&
        event.item.kind === 'proposal' &&
        event.item.proposal.type === 'architecture'
      ) {
        let item = compact.get(event.item.id);
        if (!item && (proposals || existsSync(workspace))) {
          if (!proposals) {
            proposals = new DatabaseSync(workspace, { readOnly: true });
            proposals.exec('PRAGMA busy_timeout=5000');
            if (proposals.prepare("SELECT 1 FROM sqlite_schema WHERE name='records'").get())
              metadata = proposals.prepare('SELECT metadata FROM records WHERE id=?');
          }
          const row = metadata?.get(event.item.id);
          if (row) {
            item = (JSON.parse(String(row['metadata'])) as { item: ProposalItem }).item;
            compact.set(event.item.id, item);
          }
        }
        if (item && item.proposal.type === 'architecture')
          event.item = {
            ...event.item,
            proposal: architecturePresentation(item.proposal, item.proposal.contentRef ?? item.id),
          };
      }
      timeline.apply(event);
      seq++;
    };
    let segments: number;
    try {
      segments = await replayHistory(path, startedAt, agent, attachments.context(), emit);
    } finally {
      proposals?.close();
    }
    const snapshot = { timeline: timeline.state, seq, segments };
    const after = await stat(path);
    if (`v3:${agent}:${after.size}:${after.mtimeMs}:${after.ctimeMs}` === fingerprint)
      store.db
        .prepare(
          `INSERT INTO histories VALUES (?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET fingerprint=excluded.fingerprint, snapshot=excluded.snapshot`,
        )
        .run(path, fingerprint, JSON.stringify(snapshot));
    return snapshot;
  };
}
