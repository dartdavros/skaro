import { containerTask, type DockerContainer, type TaskKey } from '@skaro/core';

/** Scope filtering precedes cleanup, stop and finished callbacks; no Docker operation is simulated. */
export class EnvironmentProjectScope {
  private readonly projectId?: string;
  constructor(projectId?: string) {
    this.projectId = projectId;
  }
  require(key: TaskKey) {
    if (this.projectId && key.projectId !== this.projectId)
      throw new Error('Environment is outside verification project scope');
  }
  records<T extends TaskKey>(records: T[]): T[] {
    return this.projectId
      ? records.filter((record) => record.projectId === this.projectId)
      : records;
  }
  containers(
    containers: DockerContainer[],
    worktrees: string,
    names: ReadonlyMap<string, TaskKey>,
  ) {
    if (!this.projectId) return containers;
    return containers.filter(
      (container) => containerTask(container, worktrees, names)?.projectId === this.projectId,
    );
  }
}
