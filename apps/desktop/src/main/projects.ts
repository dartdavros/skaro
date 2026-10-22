// Open projects in the main process: .skaro/ artifacts (with a watcher for manual edits) and git.

import {
  ArtifactStore,
  GitService,
  type AppDb,
  type ConfigDefaults,
  type ProjectArtifacts,
} from '@skaro/core';

import { PROJECT_DEFAULTS_KEY } from '../shared/ipc';
import { watchProjectArtifacts } from './project-artifact-watch';
import { assertTaskGraphAvailable } from './project-task-mutations';
import { background } from './background/client';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseMarkdown } from '@skaro/core';
import { ProjectArtifactStore } from './project-artifact-store';
import { requirementsOf } from '../shared/task-requirements';
import { ProjectArtifactMemory } from './project-artifact-memory';
import { artifactBytes } from './background/artifact-weight';

export class ProjectContext {
  readonly id: string;
  readonly root: string;
  readonly store: ArtifactStore;
  readonly git: GitService;
  readonly assertTasksMutable: () => void;
  private readonly memory: ProjectArtifactMemory;
  private revision = 0;
  private readonly defaults: () => ConfigDefaults;
  private readonly dataDir?: string;
  private stopWatch: (() => void) | undefined;

  constructor(
    id: string,
    root: string,
    onChange: () => void,
    defaults: () => ConfigDefaults,
    reservedTaskIds: () => string[] = () => [],
    assertTasksMutable: () => void = () => undefined,
    dataDir?: string,
    memory = new ProjectArtifactMemory(),
  ) {
    this.id = id;
    this.memory = memory;
    this.defaults = defaults;
    this.dataDir = dataDir;
    this.assertTasksMutable = assertTasksMutable;
    this.root = root;
    this.store = dataDir
      ? new ProjectArtifactStore(root, defaults, reservedTaskIds, dataDir)
      : new ArtifactStore(root, defaults, reservedTaskIds);
    this.git = new GitService(root);
    this.stopWatch = watchProjectArtifacts(root, this.store, (paths) => {
      this.invalidate(paths);
      onChange();
    });
  }

  /** Artifacts, cached until the files change. */
  load(): Promise<ProjectArtifacts> {
    return this.readArtifacts(false);
  }

  /** Lists and navigation never need document bodies or the complete C4 model. */
  summary(): Promise<ProjectArtifacts> {
    return this.readArtifacts(true);
  }
  private readArtifacts(summary: boolean): Promise<ProjectArtifacts> {
    const key = `${this.id}:${summary ? 'summary' : 'full'}`;
    return this.memory.read(key, async () => {
      if (this.dataDir)
        return background(
          this.dataDir,
          'artifacts.load',
          this.root,
          this.defaults(),
          this.revision,
          summary,
        );
      const value = await this.store.load(summary);
      return { value, bytes: artifactBytes(value) };
    });
  }

  /** After Skaro's own writes (the watcher does not report them). */
  async readDocument(path: string): Promise<string> {
    return this.dataDir
      ? background(this.dataDir, 'artifacts.read', this.root, path.slice('.skaro/'.length))
      : parseMarkdown(await readFile(join(this.root, path), 'utf8')).body;
  }
  readDocumentSnapshot(path: string) {
    if (this.dataDir)
      return background(
        this.dataDir,
        'artifacts.document',
        this.root,
        path.slice('.skaro/'.length),
      );
    return import('@skaro/core').then(({ readC4DocumentSnapshot }) =>
      readC4DocumentSnapshot(this.root, path.slice('.skaro/'.length)),
    );
  }

  invalidate(paths?: string[]): void {
    this.memory.forget(`${this.id}:full`);
    this.memory.forget(`${this.id}:summary`);
    this.revision++;
    if (this.dataDir)
      void background(this.dataDir, 'catalog.invalidate', this.root, paths).catch(
        (error: unknown) => console.error('Artifact catalog invalidation:', error),
      );
  }
  milestoneInfo(fallback: () => Promise<import('../shared/ipc').MilestoneInfo[]>) {
    return this.dataDir ? background(this.dataDir, 'artifacts.milestones', this.root) : fallback();
  }
  documentCatalog() {
    if (!this.dataDir) throw new Error('Document catalog requires the desktop worker');
    return background(this.dataDir, 'catalog.documents', this.root);
  }
  documentPage(kind: import('../shared/document-catalog').DocumentKind, start: number) {
    if (!this.dataDir) throw new Error('Document catalog requires the desktop worker');
    return background(this.dataDir, 'catalog.documentPage', this.root, kind, start);
  }
  documentEntry(
    key: Parameters<import('./background/protocol').BackgroundMethods['catalog.document']>[1],
  ) {
    if (!this.dataDir) throw new Error('Document catalog requires the desktop worker');
    return background(this.dataDir, 'catalog.document', this.root, key);
  }
  async documentRequirements(path: string) {
    return this.dataDir
      ? background(this.dataDir, 'artifacts.requirements', this.root, path.slice('.skaro/'.length))
      : requirementsOf(await this.readDocument(path));
  }

  close(): void {
    this.memory.forget(`${this.id}:full`);
    this.memory.forget(`${this.id}:summary`);
    this.stopWatch?.();
  }
}

export class Projects {
  private readonly db: AppDb;
  private readonly contexts = new Map<string, ProjectContext>();
  private readonly memory = new ProjectArtifactMemory();
  private readonly onChange: (projectId: string) => void;
  private readonly dataDir?: string;

  constructor(db: AppDb, onChange: (projectId: string) => void, dataDir?: string) {
    this.db = db;
    this.onChange = onChange;
    this.dataDir = dataDir;
  }

  /** App-wide defaults every project falls back to. */
  defaults(): ConfigDefaults {
    return this.db.getSetting<ConfigDefaults | null>(PROJECT_DEFAULTS_KEY, null) ?? {};
  }

  /** The defaults changed: every open project reads its settings anew. */
  defaultsChanged(): void {
    for (const [id, context] of this.contexts) {
      context.invalidate();
      this.onChange(id);
    }
  }

  get(projectId: string): ProjectContext {
    const existing = this.contexts.get(projectId);
    if (existing) return existing;
    const record = this.db.shell.get(projectId);
    if (!record) throw new Error(`unknown project ${projectId}`);
    const context = new ProjectContext(
      record.id,
      record.path,
      () => this.onChange(record.id),
      () => this.defaults(),
      () => this.db.usedTaskIds(projectId),
      () => assertTaskGraphAvailable(this.db, projectId),
      this.dataDir,
      this.memory,
    );
    this.contexts.set(projectId, context);
    return context;
  }

  /** The project folder moved: the next `get` opens it anew. */
  forget(projectId: string): void {
    this.contexts.get(projectId)?.close();
    this.contexts.delete(projectId);
  }

  close(): void {
    for (const context of this.contexts.values()) context.close();
    this.contexts.clear();
    this.memory.clear();
  }
}
