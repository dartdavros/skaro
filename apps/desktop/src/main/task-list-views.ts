import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { currentActivity } from '@skaro/timeline';
import type { ProjectArtifacts, RunRecord, Task } from '@skaro/core';
import type { TaskSummary } from '../shared/ipc';
import type { TaskRunEngine } from './task-run-engine';
import { key } from './task-run-helpers';
import { background } from './background/client';
import { taskListAssignment } from './task-list-assignment';
import { taskListSnapshot } from './task-list-reader';
import { taskResourceWait } from './resource-wait-view';

export class TaskListViews {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }
  async list(projectId: string): Promise<TaskSummary[]> {
    const ctx = this.ctx;
    const context = ctx.project(projectId);
    const merging = ctx.merges.coordinator.merging(projectId);
    const snapshot =
      ctx.deps.db.filePath === ':memory:'
        ? await (async () => {
            const artifacts = await context.summary();
            const mtimes = new Map<string, number>();
            for (const task of artifacts.tasks)
              mtimes.set(
                task.id,
                (await stat(join(context.root, task.path)).catch(() => undefined))?.mtimeMs ?? 0,
              );
            return taskListSnapshot(
              ctx.deps.db,
              projectId,
              artifacts,
              mtimes,
              ctx.integrations.store.all(projectId),
              merging,
            );
          })()
        : await background(
            ctx.deps.dataDir,
            'tasks.list',
            ctx.deps.db.filePath,
            projectId,
            merging,
          );
    for (const task of snapshot.tasks) {
      const active = ctx.active.get(key(projectId, task.id));
      if (task.status === 'in_progress' && active)
        task.activity = currentActivity(active.timeline.state);
      const id = snapshot.operations[task.id];
      const operation = id && ctx.integrations.store.find(projectId, id);
      if (operation) task.activity = await ctx.integrations.history.activity(operation);
    }
    return snapshot.tasks.map((task) => taskResourceWait(ctx.deps.db, projectId, task));
  }
  assigned(projectId: string, task: Task, run: RunRecord | undefined, artifacts: ProjectArtifacts) {
    return taskListAssignment(this.ctx.deps.db, projectId, task, run, artifacts);
  }
}
