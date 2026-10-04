// Bulk actions of the task board (Tasks mockup): archive, delete, move to a milestone, unblock.
// Runs, the queue and the agent choice stay in TaskRuns.

import type { Events, EventName } from '../shared/ipc';
import type { Projects } from './projects';
import type { TaskRuns } from './tasks';

interface Deps {
  projects: Projects;
  runs: TaskRuns;
  emit: <E extends EventName>(event: E, payload: Events[E]) => void;
  /** "Недавние события" of the project. */
  event: (projectId: string, kind: string, data: Record<string, unknown>) => void;
}

export class TaskBoard {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  /** "Архивировать": the task leaves the board, its history stays. */
  async archive(projectId: string, taskIds: string[], archived: boolean): Promise<void> {
    const { store } = this.deps.projects.get(projectId);
    for (const id of taskIds) await store.updateTask(id, { archived });
    this.done(projectId, taskIds);
  }

  /** "Удалить безвозвратно": the task file, its branches and worktrees. Merged code stays. */
  async delete(projectId: string, taskIds: string[]): Promise<void> {
    const { store } = this.deps.projects.get(projectId);
    for (const id of taskIds) {
      const task = await store.readTask(id);
      await this.deps.runs.forget(projectId, id);
      await store.deleteTask(id);
      this.deps.event(projectId, 'task_deleted', { task: id, title: task.title });
    }
    this.done(projectId, taskIds);
  }

  /** "Перенести в этап": moved tasks go to the end, keeping their order. */
  async move(projectId: string, taskIds: string[], milestoneId: string): Promise<void> {
    const context = this.deps.projects.get(projectId);
    const { tasks } = await context.load();
    const moved = tasks
      .filter((t) => taskIds.includes(t.id) && t.milestone !== milestoneId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    let order = Math.max(
      0,
      ...tasks.filter((t) => t.milestone === milestoneId).map((t) => t.order ?? 0),
    );
    for (const task of moved) {
      await context.store.updateTask(task.id, { milestone: milestoneId, order: ++order });
    }
    this.done(projectId, taskIds);
  }

  /** "Разблокировать": the task stops waiting for its dependencies. */
  async unblock(projectId: string, taskIds: string[]): Promise<void> {
    const { store } = this.deps.projects.get(projectId);
    for (const id of taskIds) await store.updateTask(id, { unblocked: true });
    this.done(projectId, taskIds);
  }

  private done(projectId: string, taskIds: string[]): void {
    this.deps.projects.get(projectId).invalidate();
    for (const taskId of taskIds) this.deps.emit('task.changed', { projectId, taskId });
    this.deps.emit('project.changed', { projectId });
  }
}
