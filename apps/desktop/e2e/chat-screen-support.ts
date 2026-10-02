import { AppDb } from '@skaro/core';
import type { TimelineEvent } from '@skaro/timeline';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './agent-task-support';

/** Authorized file/Git history, loaded through the real chat replay service. */
export function chatScreenProject(userData: string) {
  const db = AppDb.open(join(userData, 'skaro.db'));
  const project = db.addProject({ name: 'Chat screen', path: makeRepo(userData) });
  const active = db.createChat({
    projectId: project.id,
    agent: 'codex',
    title: 'Active history',
    logPath: 'chats/active.jsonl',
  });
  const archived = db.createChat({
    projectId: project.id,
    agent: 'codex',
    title: 'Archived history',
    logPath: 'chats/archived.jsonl',
  });
  db.updateChat(archived.id, { archived: true });
  db.setOpenTabs([project.id], project.id);
  db.setSetting('ui.locale', 'ru');
  db.close();
  const now = Date.now();
  const base = {
    turnId: 'history',
    status: 'done' as const,
    startedAt: now - 2000,
    native: { agent: 'skaro', type: 'verification', ref: '' },
  };
  const events: TimelineEvent[] = [
    { t: 'turn.started', turnId: 'history' },
    {
      t: 'item.upsert',
      item: { ...base, id: 'user', kind: 'message', role: 'user', text: 'A saved message' },
    },
    {
      t: 'item.upsert',
      item: {
        ...base,
        id: 'import',
        kind: 'message',
        role: 'user',
        text: 'Импортировать документацию\n~/Docs/source · 2 файла',
      },
    },
    {
      t: 'item.upsert',
      item: {
        ...base,
        id: 'reply',
        kind: 'message',
        role: 'agent',
        text: 'A saved answer',
        phase: 'final',
      },
    },
    {
      t: 'item.upsert',
      item: {
        ...base,
        id: 'background',
        kind: 'command',
        command: 'saved-background',
        output: 'Saved command output',
        outputLive: false,
        endedAt: now,
        background: { taskId: 'background', state: 'done' },
      },
    },
    {
      t: 'plan.updated',
      steps: [
        { id: 'one', text: 'Done step', status: 'done' },
        { id: 'two', text: 'Active step', activeText: 'Working step', status: 'active' },
        { id: 'three', text: 'Next step', status: 'pending' },
      ],
    },
    { t: 'turn.completed', turnId: 'history', outcome: 'done' },
  ];
  mkdirSync(join(userData, 'chats'));
  for (const chat of [active, archived])
    writeFileSync(
      join(userData, chat.logPath),
      events
        .map((event) => JSON.stringify({ ts: 0, dir: 'meta', line: { skaro: 'event', event } }))
        .join('\n') + '\n',
    );
  return { project, active, archived };
}
