// Tasks and milestones of a project, reloaded whenever its artifacts change ("Задачи", "План").

import type { MilestoneInfo, StageInfo, TaskSummary } from '../../../shared/ipc';

export class ProjectTasks {
  tasks = $state<TaskSummary[]>([]);
  milestones = $state<MilestoneInfo[]>([]);
  /** Where each stage stands: a milestone is run as a whole. */
  stages = $state<StageInfo[]>([]);
  /** A stage started now would run at once rather than wait for a slot. */
  slotsFree = $state(true);
  loaded = $state(false);
  private readonly projectId: string;
  private readonly stop: () => void;

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

  async reload(): Promise<void> {
    const [tasks, milestones, stages, slots] = await Promise.all([
      window.skaro.invoke('tasks.list', this.projectId).catch(() => []),
      window.skaro.invoke('plan.milestones', this.projectId).catch(() => []),
      window.skaro.invoke('stages.list', this.projectId).catch(() => []),
      window.skaro.invoke('tasks.slots').catch(() => undefined),
    ]);
    this.tasks = tasks;
    this.milestones = milestones;
    this.stages = stages;
    this.slotsFree = !slots || slots.free > 0;
    this.loaded = true;
  }

  dispose(): void {
    this.stop();
  }
}
