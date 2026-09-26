// Documents of a project and the open one: its text, the editor draft, a change on disk.

import type { DocEntry } from '../../../shared/ipc';
import { ARCHITECTURE, fixed } from './model';

export class ProjectDocs {
  entries = $state<DocEntry[]>([]);
  loaded = $state(false);
  selected = $state(ARCHITECTURE);
  /** Text of the open document as it is on disk. */
  text = $state('');
  editing = $state(false);
  draft = $state('');
  /** The file changed on disk while it was edited (text there now). */
  conflict = $state<string | undefined>();
  private readonly projectId: string;
  private readonly stop: () => void;

  constructor(projectId: string) {
    this.projectId = projectId;
    void this.reload();
    this.stop = window.skaro.on('project.changed', (p) => {
      if (p.projectId === projectId) void this.reload();
    });
  }

  get dirty(): boolean {
    return this.editing && this.draft !== this.text;
  }

  /** Brief and architecture first (even when missing), then ADRs and free documents. */
  get all(): DocEntry[] {
    return [
      ...fixed(this.entries),
      ...this.entries.filter((d) => d.kind === 'adr' || d.kind === 'doc'),
    ];
  }

  get current(): DocEntry | undefined {
    return this.all.find((d) => d.path === this.selected);
  }

  exists(path: string): boolean {
    return this.entries.some((d) => d.path === path);
  }

  async reload(): Promise<void> {
    this.entries = await window.skaro.invoke('docs.list', this.projectId).catch(() => []);
    this.loaded = true;
    const disk = await this.readDisk(this.selected);
    if (this.editing && disk !== this.text && disk !== this.draft) this.conflict = disk;
    else if (!this.editing) this.text = disk;
  }

  async open(path: string): Promise<void> {
    this.selected = path;
    this.editing = false;
    this.conflict = undefined;
    this.text = await this.readDisk(path);
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

  private async readDisk(path: string): Promise<string> {
    if (!this.exists(path)) return '';
    return window.skaro.invoke('docs.read', this.projectId, path).catch(() => '');
  }

  dispose(): void {
    this.stop();
  }
}
