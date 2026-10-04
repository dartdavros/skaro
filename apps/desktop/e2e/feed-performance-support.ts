import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppDb } from '@skaro/core';
import type { Item, TimelineEvent } from '@skaro/timeline';
import { makeRepo } from './agent-task-support';

/** Authorized file/Git history, replayed by the real Electron chat backend. */
export function longHistory(userData: string) {
  const repo = makeRepo(userData);
  const db = AppDb.open(join(userData, 'skaro.db'));
  const project = db.addProject({ name: 'Long history', path: repo });
  const chat = db.createChat({
    projectId: project.id,
    agent: 'codex',
    title: 'Long history',
    logPath: 'chats/long.jsonl',
  });
  db.setOpenTabs([project.id], project.id);
  db.setSetting('ui.locale', 'ru');
  db.close();
  const events: TimelineEvent[] = [];
  const item = (entry: Item) => events.push({ t: 'item.upsert', item: entry });
  for (let n = 0; n < 600; n++) {
    const turnId = `turn-${n}`;
    events.push({ t: 'turn.started', turnId });
    const base = {
      turnId,
      status: 'done' as const,
      startedAt: n * 1000,
      native: { agent: 'skaro', type: 'verification', ref: String(n) },
    };
    item({ ...base, id: `user-${n}`, kind: 'message', role: 'user', text: `Message ${n}` });
    item({
      ...base,
      id: `reply-${n}`,
      kind: 'message',
      role: 'agent',
      phase: 'final',
      text: `Reply ${n}\n\nA paragraph with **formatting**, a [link](https://example.com) and inline \`code\`.\n\n- First item\n- Second item`,
    });
    events.push({ t: 'turn.completed', turnId, outcome: 'done' });
  }
  const base = {
    turnId: 'large',
    status: 'done' as const,
    startedAt: 600_000,
    native: { agent: 'skaro', type: 'verification', ref: 'large' },
  };
  const output = Array.from({ length: 20_000 }, (_, n) => `output-${n}`).join('\n');
  const diff =
    '@@ -0,0 +1,10000 @@\n' +
    Array.from(
      { length: 10_000 },
      (_, n) => `+diff-${n}${n === 100 ? ' wide'.repeat(150) : ''}`,
    ).join('\n');
  events.push({ t: 'turn.started', turnId: 'large' });
  item({
    ...base,
    id: 'large-command',
    kind: 'command',
    command: 'large-output',
    output,
    outputLive: false,
    exitCode: 0,
  });
  item({
    ...base,
    id: 'large-file',
    kind: 'file_change',
    files: [{ path: 'large.txt', change: 'add', diff, added: 10_000, removed: 0 }],
  });
  events.push({ t: 'turn.completed', turnId: 'large', outcome: 'done' });
  mkdirSync(join(userData, 'chats'));
  writeFileSync(
    join(userData, chat.logPath),
    events
      .map((event, ts) => JSON.stringify({ ts, dir: 'meta', line: { skaro: 'event', event } }))
      .join('\n') + '\n',
  );
  return { output, diff };
}
