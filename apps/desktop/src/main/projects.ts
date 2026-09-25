// Open projects in the main process: .skaro/ artifacts (with a watcher for manual edits) and git.

import { ArtifactStore, GitService, type AppDb, type ProjectArtifacts } from '@skaro/core';

export class ProjectContext {
  readonly id: string;
  readonly root: string;
  readonly store: ArtifactStore;
  readonly git: GitService;
  private artifacts: Promise<ProjectArtifacts> | undefined;
  private stopWatch: (() => void) | undefined;

  constructor(id: string, root: string, onChange: () => void) {
    this.id = id;
    this.root = root;
    this.store = new ArtifactStore(root);
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

  get(projectId: string): ProjectContext {
    const existing = this.contexts.get(projectId);
    if (existing) return existing;
    const record = this.db.getProject(projectId);
    if (!record) throw new Error(`unknown project ${projectId}`);
    const context = new ProjectContext(record.id, record.path, () => this.onChange(record.id));
    this.contexts.set(projectId, context);
    return context;
  }

  close(): void {
    for (const context of this.contexts.values()) context.close();
    this.contexts.clear();
  }
}
