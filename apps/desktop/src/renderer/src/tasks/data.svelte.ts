// Tasks and milestones of a project, reloaded whenever its artifacts change ("Задачи", "План").

import type { MilestoneInfo, StageInfo, TaskSummary, TaskAssignment } from '../../../shared/ipc';
import { SvelteSet } from 'svelte/reactivity';
import { canStart } from './task-rules';
import type {
  TaskCatalogInfo,
  TaskQuery,
  TaskRange,
  TaskEntry,
} from '../../../shared/task-catalog';

export class ProjectTasks {
  private readonly launching = new SvelteSet<string>();
  private disposed = false;
  catalog = $state.raw<TaskCatalogInfo>();
  version = $state(0);
  milestones = $state<MilestoneInfo[]>([]);
  /** Where each stage stands: a milestone is run as a whole. */
  stages = $state<StageInfo[]>([]);
  loaded = $state(false);
  private readonly projectId: string;
  private readonly stop: () => void;
  private reloading?: Promise<void>;
  private reloadAgain = false;

  constructor(projectId: string) {
    this.projectId = projectId;
    void this.reload();
    const changed = (p: { projectId: string }) => {
      if (p.projectId === projectId) void this.reload();
    };
    const stopProject = window.skaro.on('project.changed', changed);
    const stopTask = window.skaro.on('task.changed', changed);
    this.stop = () => {
      stopProject();
      stopTask();
    };
  }

  reload(): Promise<void> {
    if (this.reloading) {
      this.reloadAgain = true;
      return this.reloading;
    }
    this.reloading = (async () => {
      do {
        this.reloadAgain = false;
        await this.load();
      } while (this.reloadAgain);
    })().finally(() => {
      this.reloading = undefined;
    });
    return this.reloading;
  }

  private async load(): Promise<void> {
    const [catalog, stages] = await Promise.all([
      window.skaro.invoke('tasks.catalog', this.projectId),
      window.skaro.invoke('stages.list', this.projectId).catch(() => []),
    ]);
    if (this.disposed) return;
    this.catalog = catalog;
    this.version++;
    this.milestones = catalog.milestones;
    this.stages = stages;
    this.loaded = true;
  }

  present(task: TaskSummary): TaskSummary {
    return this.launching.has(task.id) && canStart(task) ? { ...task, status: 'queued' } : task;
  }
  async query(query: TaskQuery): Promise<TaskRange> {
    if (!this.loaded) await this.reload();
    const moved = { ...query.moved };
    for (const id of this.launching) moved[id] = 'working';
    return window.skaro.invoke('tasks.query', this.projectId, { ...query, moved });
  }
  async page(source: TaskRange, start: number): Promise<TaskEntry[]> {
    return (await window.skaro.invoke('tasks.page', source, start)).map((entry) =>
      entry.kind === 'task' ? { ...entry, task: this.present(entry.task) } : entry,
    );
  }
  dispose(): void {
    this.disposed = true;
    this.stop();
  }
  /** Show the established queue state in the same frame as the owner's launch action. */
  async run(ids: string[], message: string, assignment?: TaskAssignment): Promise<void> {
    const accepted = ids.filter((id) => !this.launching.has(id));
    if (!accepted.length) return;
    for (const id of accepted) this.launching.add(id);
    this.version++;
    try {
      await window.skaro.invoke('tasks.run', this.projectId, accepted, message, assignment);
      await this.reload();
    } finally {
      for (const id of accepted) this.launching.delete(id);
      this.version++;
    }
  }
}
