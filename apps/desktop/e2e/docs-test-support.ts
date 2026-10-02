import { AppDb, ArtifactStore } from '@skaro/core';
import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './agent-task-support';

export const architecture = [
  '## Overview',
  '',
  'An architecture paragraph with [ADR](adr/0001).',
  '',
  '## Modules',
  '',
  '- Core',
  '- Desktop',
  '',
  '## Правила',
  '',
  '- Keep modules small.',
  '',
  '## Example',
  '',
  '```js',
  'export const example = 1;',
  '```',
  '',
].join('\n');

/** Authorized files; the app reads documents through its native artifact service. */
export async function docsProject(userData: string) {
  const store = new ArtifactStore(makeRepo(userData));
  await store.writeDoc('architecture.md', architecture);
  await store.writeDoc('brief.md', '## Purpose\n\nA brief.\n');
  await store.writeDoc('docs/reference.md', '# Reference\n\nSome reference text.\n');
  await store.createAdr({
    title: 'Module decision',
    date: '2026-10-01',
    body: '## Решение\n\nUse modules.\n',
  });
  await store.createSpec({
    title: 'Calculation specification',
    date: '2026-10-01',
    body: '## Требования\n\n- Addition.\n',
  });
  await store.updateTask('T-001', { spec: '0001', status: 'done' });
  const db = AppDb.open(join(userData, 'skaro.db'));
  const project = db.addProject({ name: 'Documents', path: store.root });
  db.setOpenTabs([project.id], project.id);
  db.setSetting('ui.locale', 'ru');
  db.setSetting('ui.docTree', { open: true, width: 256 });
  db.setSetting('ui.tocPanel', true);
  db.close();
  const artifacts = await store.load();
  for (const path of [
    '.skaro/architecture.md',
    '.skaro/brief.md',
    '.skaro/docs/reference.md',
    ...artifacts.adrs.map((item) => item.path),
    ...artifacts.specs.map((item) => item.path),
  ]) {
    const date = new Date('2026-10-01T08:00:00Z');
    utimesSync(join(store.root, path), date, date);
  }
  return store;
}
