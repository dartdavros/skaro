// "Документы" (Documents mockup): brief, architecture, ADRs, specifications and free documents
// in .skaro/.

import { stat } from 'node:fs/promises';
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
        adr: record(adr),
      });
    }
    for (const spec of artifacts.specs) {
      entries.push({
        kind: 'spec',
        path: spec.path,
        title: spec.title,
        editedAt: await edited(spec.path),
        spec: record(spec),
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
      artifacts.adrs.find((a) => a.path === path) ??
      artifacts.specs.find((s) => s.path === path);
    if (!doc) throw new Error(`unknown document ${path}`);
    return doc.body;
  }

  async write(projectId: string, path: string, text: string): Promise<void> {
    const context = this.deps.projects.get(projectId);
    const inner = this.inner(path);
    const artifacts = /^(adr|specs)\//.test(inner) ? await context.load() : undefined;
    const adr = artifacts?.adrs.find((a) => a.path === path);
    const spec = artifacts?.specs.find((s) => s.path === path);
    if (adr) await context.store.writeAdr(adr.id, text);
    else if (spec) await context.store.writeSpec(spec.id, text);
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
    await this.deps.projects.get(projectId).store.setSpecStatus(specId, status);
    this.changed(projectId);
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

function record(item: Adr | Spec): DocRecord {
  return {
    id: item.id,
    status: item.status,
    ...(item.date ? { date: item.date } : {}),
    ...(item.replaces ? { replaces: item.replaces } : {}),
    ...(item.replacedBy ? { replacedBy: item.replacedBy } : {}),
  };
}
