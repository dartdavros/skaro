// "Документы" (Documents mockup): brief, architecture, ADRs and free documents in .skaro/.

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { SKARO_DIR, type AdrStatus } from '@skaro/core';
import type { DocEntry, Events, EventName } from '../shared/ipc';
import type { Projects } from './projects';

interface Deps {
  projects: Projects;
  emit: <E extends EventName>(event: E, payload: Events[E]) => void;
  reveal: (path: string) => void;
}

const PREFIX = `${SKARO_DIR}/`;

export class Docs {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  async list(projectId: string): Promise<DocEntry[]> {
    const context = this.deps.projects.get(projectId);
    const artifacts = await context.load();
    const edited = async (path: string) =>
      (await stat(join(context.root, path)).catch(() => undefined))?.mtimeMs ?? 0;
    const entries: DocEntry[] = [];
    for (const doc of [artifacts.brief, artifacts.architecture]) {
      if (!doc) continue;
      entries.push({
        kind: doc.kind,
        path: doc.path,
        title: doc.title,
        editedAt: await edited(doc.path),
      });
    }
    for (const adr of artifacts.adrs) {
      entries.push({
        kind: 'adr',
        path: adr.path,
        title: adr.title,
        editedAt: await edited(adr.path),
        adr: {
          id: adr.id,
          status: adr.status,
          ...(adr.date ? { date: adr.date } : {}),
          ...(adr.replaces ? { replaces: adr.replaces } : {}),
          ...(adr.replacedBy ? { replacedBy: adr.replacedBy } : {}),
        },
      });
    }
    for (const doc of artifacts.docs) {
      entries.push({
        kind: 'doc',
        path: doc.path,
        title: doc.path.split('/').pop()!,
        editedAt: await edited(doc.path),
      });
    }
    return entries;
  }

  async read(projectId: string, path: string): Promise<string> {
    const context = this.deps.projects.get(projectId);
    context.invalidate();
    const artifacts = await context.load();
    const doc =
      [artifacts.brief, artifacts.architecture, ...artifacts.docs].find((d) => d?.path === path) ??
      artifacts.adrs.find((a) => a.path === path);
    if (!doc) throw new Error(`unknown document ${path}`);
    return doc.body;
  }

  async write(projectId: string, path: string, text: string): Promise<void> {
    const context = this.deps.projects.get(projectId);
    const inner = this.inner(path);
    const adr = /^adr\//.test(inner)
      ? (await context.load()).adrs.find((a) => a.path === path)
      : undefined;
    if (adr) await context.store.writeAdr(adr.id, text);
    else await context.store.writeDoc(inner, text);
    this.changed(projectId);
  }

  async create(projectId: string, name: string): Promise<DocEntry> {
    const file = name.trim().replace(/\.md$/i, '');
    if (!/^[\w.-]+$/.test(file)) throw new Error(`not a document name: ${name}`);
    const context = this.deps.projects.get(projectId);
    const doc = await context.store.writeDoc(`docs/${file}.md`, '');
    this.changed(projectId);
    return { kind: 'doc', path: doc.path, title: `${file}.md`, editedAt: Date.now() };
  }

  async setAdrStatus(projectId: string, adrId: string, status: AdrStatus): Promise<void> {
    await this.deps.projects.get(projectId).store.setAdrStatus(adrId, status);
    this.changed(projectId);
  }

  reveal(projectId: string, path: string): void {
    this.inner(path);
    this.deps.reveal(join(this.deps.projects.get(projectId).root, path));
  }

  /** The path inside .skaro/; anything outside is refused. */
  private inner(path: string): string {
    if (!path.startsWith(PREFIX) || path.includes('..')) throw new Error(`not a document: ${path}`);
    return path.slice(PREFIX.length);
  }

  private changed(projectId: string): void {
    this.deps.projects.get(projectId).invalidate();
    this.deps.emit('project.changed', { projectId });
  }
}
