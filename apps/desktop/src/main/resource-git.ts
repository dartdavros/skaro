import { GitService, type MergeOptions } from '@skaro/core';
import type { ApplicationResources } from './application-resources';
import { resourceExecution } from './resource-execution';

/** Every materialized checkout, including merge internals and history restoration, shares admission. */
export class ResourceGit extends GitService {
  private readonly projectId: string;
  private readonly resources: ApplicationResources;
  constructor(root: string, projectId: string, resources: ApplicationResources) {
    super(root, {
      requireWorktreeActive: () => resourceExecution.getStore()?.signal.throwIfAborted(),
    });
    this.projectId = projectId;
    this.resources = resources;
  }
  private admitted<T>(owner: string, action: () => Promise<T>): Promise<T> {
    const current = resourceExecution.getStore();
    if (current?.projectId === this.projectId) return this.resources.phase('worktree', action);
    return this.resources.scope(this.projectId, owner, () =>
      this.resources.phase('worktree', action),
    );
  }
  override createWorktree(options: Parameters<GitService['createWorktree']>[0]): Promise<void> {
    return this.admitted(`checkout:${options.path}`, () => super.createWorktree(options));
  }
  override createDetachedWorktree(path: string, base: string): Promise<void> {
    return this.admitted(`checkout:${path}`, () => super.createDetachedWorktree(path, base));
  }
  override merge(options: MergeOptions) {
    return this.admitted(`publication:${options.branch}`, () => super.merge(options));
  }
}
