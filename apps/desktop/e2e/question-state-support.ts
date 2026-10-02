import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppDb } from '@skaro/core';
import type { Interaction, TimelineEvent } from '@skaro/timeline';
import { makeRepo } from './agent-task-support';

/** Authorized file fixtures, consumed by the real chat replay service. */
export function questionProject(userData: string): void {
  const db = AppDb.open(join(userData, 'skaro.db'));
  const project = db.addProject({ name: 'Questions', path: makeRepo(userData) });
  const chat = db.createChat({
    projectId: project.id,
    agent: 'codex',
    title: 'Question states',
    logPath: 'chats/questions.jsonl',
  });
  db.setOpenTabs([project.id], project.id);
  db.setSetting('ui.locale', 'ru');
  db.close();
  const interaction: Extract<Interaction, { kind: 'question' }> = {
    kind: 'question',
    id: 'questions',
    delivery: 'async',
    questions: [
      {
        id: 'single',
        header: 'Single',
        text: 'Choose one',
        multi: false,
        allowFreeText: true,
        options: [
          { label: 'First', description: 'First note', preview: 'first preview' },
          { label: 'Second', description: 'Second note', preview: 'second preview' },
        ],
      },
      {
        id: 'multi',
        header: 'Multiple',
        text: 'Choose several',
        multi: true,
        allowFreeText: true,
        options: [{ label: 'Alpha' }, { label: 'Beta' }],
      },
      {
        id: 'text',
        header: 'Text',
        text: 'Enter text',
        multi: false,
        allowFreeText: true,
        options: [],
      },
      {
        id: 'secret',
        header: 'Secret',
        text: 'Enter secret',
        multi: false,
        allowFreeText: true,
        secret: true,
        options: [],
      },
    ],
  };
  mkdirSync(join(userData, 'chats'));
  const events: TimelineEvent[] = [
    {
      t: 'item.upsert',
      item: {
        id: 'intro',
        kind: 'message',
        role: 'agent',
        text: 'Question state verification',
        turnId: '',
        startedAt: 0,
        status: 'done',
        native: { agent: 'skaro', type: 'message', ref: '' },
      },
    },
    { t: 'interaction.opened', interaction },
  ];
  writeFileSync(
    join(userData, chat.logPath),
    events
      .map((event) => JSON.stringify({ ts: 0, dir: 'meta', line: { skaro: 'event', event } }))
      .join('\n') + '\n',
  );
}
