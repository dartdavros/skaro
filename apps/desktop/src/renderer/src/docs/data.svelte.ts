// Documents of a project and the open one: its text, the editor draft, a change on disk.

import type { DocEntry } from '../../../shared/ipc';
import { ARCHITECTURE, fixed } from './model';
import type { DocumentCatalog, DocumentKind } from '../../../shared/document-catalog';

export class ProjectDocs {
  entries = $state<DocEntry[]>([]);
  catalog = $state.raw<DocumentCatalog>({
    revision: 0,
    counts: { adr: 0, spec: 0, doc: 0 },
    fixed: [],
    nextSpec: 'SPEC-0001',
  });
  loaded = $state(false);
  loading = $state(false);
  selected = $state(ARCHITECTURE);
  /** Text of the open document as it is on disk. */
  text = $state('');
  attachment = $state.raw<import('@skaro/core/c4-view').C4Attachment>();
  editing = $state(false);
  draft = $state('');
  /** The file changed on disk while it was edited (text there now). */
  conflict = $state<string | undefined>();
  readonly projectId: string;
  private readonly stop: () => void;
  private reading = 0;

  constructor(projectId: string) {
    this.projectId = projectId;
    try {
      this.selected = localStorage.getItem(`skaro.doc.${projectId}`) ?? ARCHITECTURE;
    } catch {
      /* Optional viewport preferences. */
    }
    void this.reload();
    this.stop = window.skaro.on('project.changed', (p) => {
      if (p.projectId === projectId) void this.reload();
    });
  }

  get dirty(): boolean {
    return this.editing && this.draft !== this.text;
  }

  /** Brief and architecture first (even when missing), then ADRs, specifications, documents. */
  get all(): DocEntry[] {
    return [
      ...fixed(this.entries),
      ...this.entries.filter((d) => d.kind === 'adr'),
      ...this.entries.filter((d) => d.kind === 'spec'),
      ...this.entries.filter((d) => d.kind === 'doc'),
    ];
  }

  get current(): DocEntry | undefined {
    return this.all.find((d) => d.path === this.selected);
  }

  exists(path: string): boolean {
    return this.entries.some((d) => d.path === path);
  }

  async reload(): Promise<void> {
    const revision = ++this.reading;
    this.loading = true;
    const catalog = await window.skaro.invoke('docs.catalog', this.projectId);
    if (revision !== this.reading) return;
    this.catalog = catalog;
    this.entries = catalog.fixed;
    this.loaded = true;
    const disk = await this.readDisk(this.selected, revision);
    if (revision !== this.reading) return;
    if (this.editing && disk !== this.text && disk !== this.draft) this.conflict = disk;
    else if (!this.editing) this.text = disk;
    this.loading = false;
  }

  async open(path: string): Promise<void> {
    const revision = ++this.reading;
    this.loading = true;
    this.selected = path;
    try {
      localStorage.setItem(`skaro.doc.${this.projectId}`, path);
    } catch {
      /* Optional viewport preferences. */
    }
    this.editing = false;
    this.conflict = undefined;
    const text = await this.readDisk(path, revision);
    if (revision === this.reading) {
      this.text = text;
      this.loading = false;
    }
  }

  edit(start?: string): void {
    this.draft = start ?? this.text;
    this.conflict = undefined;
    this.editing = true;
  }

  cancel(): void {
    this.editing = false;
    this.conflict = undefined;
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    const text = this.draft;
    await window.skaro.invoke('docs.write', this.projectId, this.selected, text);
    this.text = text;
    this.editing = false;
    this.conflict = undefined;
  }

  /** "Загрузить с диска" / "Оставить мою версию". */
  resolve(load: boolean): void {
    const disk = this.conflict ?? this.text;
    if (load) this.draft = disk;
    this.text = disk;
    this.conflict = undefined;
  }

  private async readDisk(path: string, revision: number): Promise<string> {
    const entry = await this.lookup({ path });
    if (revision !== this.reading) return '';
    this.entries = [
      ...this.catalog.fixed,
      ...(entry && !this.catalog.fixed.some((fixed) => fixed.path === path) ? [entry] : []),
    ];
    if (!entry) { this.attachment = undefined; return ''; }
    const snapshot = await window.skaro.invoke('docs.document', this.projectId, path);
    if (revision === this.reading) this.attachment = snapshot.attachment;
    return snapshot.body;
  }
  lookup(key: { path: string } | { kind: DocumentKind; id: string }) {
    return window.skaro.invoke('docs.lookup', this.projectId, key);
  }
  async page(kind: DocumentKind, start: number) {
    const entries = await window.skaro.invoke('docs.page', this.projectId, kind, start);
    return entries.map((entry, offset) => ({ ...entry, id: String(start + offset) }));
  }

  dispose(): void {
    this.stop();
  }
}
