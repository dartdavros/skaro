// "Документы" (Documents mockup): brief, architecture, ADRs, specifications and free documents
// in .skaro/.

import { join } from 'node:path';
import { SKARO_DIR, type Adr, type AdrStatus, type Spec, type SpecStatus } from '@skaro/core';
import type { DocEntry, DocRecord, Events, EventName } from '../shared/ipc';
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
  catalog(projectId: string) {
    return this.deps.projects.get(projectId).documentCatalog();
  }
  page(projectId: string, kind: import('../shared/document-catalog').DocumentKind, start: number) {
    return this.deps.projects.get(projectId).documentPage(kind, start);
  }
  lookup(
    projectId: string,
    key: Parameters<import('../shared/document-catalog').DocumentCatalogMethods['docs.lookup']>[1],
  ) {
    return this.deps.projects.get(projectId).documentEntry(key);
  }

  /** Compatibility for explicit full-list consumers; normal navigation uses bounded pages. */
  async list(projectId: string): Promise<DocEntry[]> {
    const context = this.deps.projects.get(projectId);
    const catalog = await context.documentCatalog();
    const entries = [...catalog.fixed].sort(
      (a, b) => Number(a.kind === 'architecture') - Number(b.kind === 'architecture'),
    );
    for (const kind of ['adr', 'spec', 'doc'] as const)
      for (let start = 0; start < catalog.counts[kind]; start += 16)
        entries.push(...(await context.documentPage(kind, start)));
    return entries;
  }

  async read(projectId: string, path: string): Promise<string> {
    const context = this.deps.projects.get(projectId);
    this.inner(path);
    if (!(await context.documentEntry({ path }))) throw new Error(`unknown document ${path}`);
    return context.readDocument(path);
  }
  async document(projectId: string, path: string) {
    const context = this.deps.projects.get(projectId);
    this.inner(path);
    if (!(await context.documentEntry({ path }))) throw new Error(`unknown document ${path}`);
    return context.readDocumentSnapshot(path);
  }

  async write(projectId: string, path: string, text: string): Promise<void> {
    const context = this.deps.projects.get(projectId);
    const inner = this.inner(path);
    await context.store.writeDocumentBody(inner, text);
    this.changed(projectId, [inner]);
  }

  async create(projectId: string, name: string): Promise<DocEntry> {
    const file = name.trim().replace(/\.md$/i, '');
    if (!/^[\w.-]+$/.test(file)) throw new Error(`not a document name: ${name}`);
    const context = this.deps.projects.get(projectId);
    const doc = await context.store.writeDoc(`docs/${file}.md`, '');
    this.changed(projectId);
    return { kind: 'doc', path: doc.path, title: `${file}.md`, editedAt: Date.now() };
  }

  async createSpec(projectId: string, title: string): Promise<DocEntry> {
    const name = title.trim();
    if (!name) throw new Error('a specification needs a title');
    const spec = await this.deps.projects.get(projectId).store.createSpec({ title: name });
    this.changed(projectId);
    return {
      kind: 'spec',
      path: spec.path,
      title: spec.title,
      editedAt: Date.now(),
      spec: record(spec),
    };
  }

  async setSpecStatus(projectId: string, specId: string, status: SpecStatus): Promise<void> {
    await this.deps.projects.get(projectId).store.setDocumentStatus('spec', specId, status);
    this.changed(projectId);
  }

  async setAdrStatus(projectId: string, adrId: string, status: AdrStatus): Promise<void> {
    await this.deps.projects.get(projectId).store.setDocumentStatus('adr', adrId, status);
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

  private changed(projectId: string, paths?: string[]): void {
    this.deps.projects.get(projectId).invalidate(paths);
    this.deps.emit('project.changed', { projectId });
  }
}

function record(item: Adr | Spec): DocRecord {
  return {
    id: item.id,
    status: item.status,
    ...(item.date ? { date: item.date } : {}),
    ...(item.replaces ? { replaces: item.replaces } : {}),
    ...(item.replacedBy ? { replacedBy: item.replacedBy } : {}),
  };
}
