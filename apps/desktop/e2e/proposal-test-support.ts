import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppDb } from '@skaro/core';
import type { Item, Proposal } from '@skaro/timeline';
import type { ImportState } from '../src/main/imports';
import { makeRepo } from './agent-task-support';

/** Authorized files, read by real chat replay/import services; no HTTP or IPC substitutions. */
export function proposalProject(userData: string) {
  const repo = makeRepo(userData);
  const db = AppDb.open(join(userData, 'skaro.db'));
  const project = db.addProject({ name: 'Proposal verification', path: repo });
  const chat = db.createChat({
    projectId: project.id,
    agent: 'codex',
    title: 'Proposal review',
    logPath: 'chats/proposals.jsonl',
  });
  db.setOpenTabs([project.id], project.id);
  db.setSetting('ui.locale', 'ru');
  const dir = join(userData, 'imports', project.id, 'review');
  const state: ImportState = {
    id: 'review',
    dir,
    sources: [],
    staged: [
      {
        key: 'brief',
        type: 'brief',
        title: 'Бриф импорта',
        body: '# Imported brief\n\nProject purpose.\n',
        sources: ['code'],
      },
      {
        key: 'architecture',
        type: 'architecture',
        title: 'Архитектура импорта',
        body: '# Architecture\n\nA paragraph.\n\n- First part\n',
        sources: ['code'],
      },
      {
        key: 'adr',
        type: 'adr',
        title: 'ADR импорта',
        body: '## Решение\n\nUse modules.\n',
        sources: ['code'],
      },
      {
        key: 'spec',
        type: 'spec',
        title: 'Спецификация импорта',
        body: '## Требования\n\n- R-1: Feature.\n',
        sources: ['code'],
      },
      {
        key: 'doc',
        type: 'doc',
        name: 'glossary.md',
        title: 'Словарь',
        body: '# Glossary\n\nA definition.\n',
        sources: ['code'],
      },
      {
        key: 'milestone',
        type: 'milestone',
        title: 'Этап импорта',
        body: '## Цель\n\nGoal.\n\n## Готово, когда\n\nDone.\n',
        sources: ['code'],
      },
      {
        key: 'task',
        type: 'task',
        title: 'Задача импорта',
        body: '## Цель\n\nGoal.\n\n## Критерии приёмки\n\n- Feature.\n',
        milestone: 'milestone',
        dependsOn: [],
        sources: ['code'],
      },
    ],
    report: {
      skipped: [{ path: 'diagram.vsdx', reason: 'Unsupported format' }],
      notes: ['Import note'],
    },
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
  db.setSetting(`import.${chat.id}`, { id: state.id, dir });
  db.close();
  const proposals: Proposal[] = [
    { type: 'doc', path: 'brief.md', after: '# Proposal brief\n\nA paragraph.\n' },
    { type: 'adr', id: '0001', title: 'Module decision', body: '## Решение\n\nUse `modules`.\n' },
    {
      type: 'spec',
      id: '0001',
      title: 'Feature specification',
      body: '## Требования\n\n- R-1: Feature.\n',
    },
    {
      type: 'plan',
      milestone: {
        id: 'M01',
        title: 'Proposed milestone',
        body: '## Цель\n\nGoal.\n',
        isNew: true,
      },
      tasks: [
        {
          ref: 'plan-task',
          title: 'Proposed task',
          body: '## Цель\n\nGoal.\n\n## Критерии приёмки\n\n- Feature.\n',
          dependsOn: [],
          dependsOnTitles: [],
        },
      ],
    },
    {
      type: 'import',
      id: state.id,
      groups: [
        { kind: 'brief', count: 1, updates: 0 },
        { kind: 'architecture', count: 1, updates: 0 },
        { kind: 'adr', count: 1, updates: 0 },
        { kind: 'spec', count: 1, updates: 0 },
        { kind: 'doc', count: 1, updates: 0 },
        { kind: 'plan', count: 1, tasks: 1, updates: 0 },
      ],
      total: state.staged.length,
      skipped: 1,
      notes: 1,
    },
  ];
  const events = proposals.map((proposal, index) => {
    const item: Extract<Item, { kind: 'proposal' }> = {
      id: `proposal-${index}`,
      turnId: '',
      kind: 'proposal',
      proposal,
      state: 'pending',
      status: 'done',
      startedAt: index,
      native: { agent: 'skaro', type: 'proposal', ref: proposal.type },
    };
    return { ts: index, dir: 'meta', line: { skaro: 'event', event: { t: 'item.upsert', item } } };
  });
  mkdirSync(join(userData, 'chats'));
  writeFileSync(
    join(userData, chat.logPath),
    events.map((event) => JSON.stringify(event)).join('\n') + '\n',
  );
  return { repo, project, chat };
}
