import {
  ArtifactStore,
  type ConfigDefaults,
  type ProjectArtifacts,
  type AdrStatus,
  type SpecStatus,
} from '@skaro/core';
import { background } from './background/client';

/** Indexed reads and document writes run in workers; task mutations keep their domain boundary. */
export class ProjectArtifactStore extends ArtifactStore {
  private readonly dataDir: string;
  private readonly configDefaults: () => ConfigDefaults;
  constructor(
    root: string,
    defaults: () => ConfigDefaults,
    reserved: () => string[],
    dataDir: string,
  ) {
    super(root, defaults, reserved);
    this.dataDir = dataDir;
    this.configDefaults = defaults;
  }
  override setDocumentStatus(
    kind: 'adr' | 'spec',
    id: string,
    status: AdrStatus | SpecStatus,
  ): Promise<void> {
    return background(this.dataDir, 'artifacts.setDocumentStatus', this.root, kind, id, status);
  }
  override writeDocumentBody(path: string, body: string): Promise<void> {
    return background(this.dataDir, 'artifacts.writeDocumentBody', this.root, path, body);
  }
  override load(summary = false, includeC4 = false): Promise<ProjectArtifacts> {
    return background(
      this.dataDir,
      'artifacts.load',
      this.root,
      this.configDefaults(),
      0,
      summary,
      includeC4,
    ).then((snapshot) => snapshot.value);
  }
}
