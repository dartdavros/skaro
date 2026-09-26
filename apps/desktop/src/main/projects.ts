// Open projects in the main process: .skaro/ artifacts (with a watcher for manual edits) and git.

import {
  ArtifactStore,
  GitService,
  type AppDb,
  type ConfigDefaults,
  type ProjectArtifacts,
} from '@skaro/core';

import { PROJECT_DEFAULTS_KEY } from '../shared/ipc';

export class ProjectContext {
  readonly id: string;
  readonly root: string;
  readonly store: ArtifactStore;
  readonly git: GitService;
  private artifacts: Promise<ProjectArtifacts> | undefined;
  private stopWatch: (() => void) | undefined;

  constructor(id: string, root: string, onChange: () => void, defaults: () => ConfigDefaults) {
    this.id = id;
    this.root = root;
    this.store = new ArtifactStore(root, defaults);
    this.git = new GitService(root);
    try {
      this.stopWatch = this.store.watch(() => {
        this.artifacts = undefined;
        onChange();
      });
    } catch {
      // No .skaro/ yet: nothing to watch.
    }
  }

  /** Artifacts, cached until the files change. */
  load(): Promise<ProjectArtifacts> {
    this.artifacts ??= this.store.load();
    this.artifacts.catch(() => (this.artifacts = undefined));
    return this.artifacts;
  }

  /** After Skaro's own writes (the watcher does not report them). */
  invalidate(): void {
    this.artifacts = undefined;
  }

  close(): void {
    this.stopWatch?.();
  }
}

export class Projects {
  private readonly db: AppDb;
  private readonly contexts = new Map<string, ProjectContext>();
  private readonly onChange: (projectId: string) => void;

  constructor(db: AppDb, onChange: (projectId: string) => void) {
    this.db = db;
    this.onChange = onChange;
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
    const record = this.db.getProject(projectId);
    if (!record) throw new Error(`unknown project ${projectId}`);
    const context = new ProjectContext(
      record.id,
      record.path,
      () => this.onChange(record.id),
      () => this.defaults(),
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
  }
}
