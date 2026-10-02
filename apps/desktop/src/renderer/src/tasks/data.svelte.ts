// Tasks and milestones of a project, reloaded whenever its artifacts change ("Задачи", "План").

import type { MilestoneInfo, TaskSummary } from '../../../shared/ipc';

export class ProjectTasks {
  tasks = $state<TaskSummary[]>([]);
  milestones = $state<MilestoneInfo[]>([]);
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
    const [tasks, milestones] = await Promise.all([
      window.skaro.invoke('tasks.list', this.projectId).catch(() => []),
      window.skaro.invoke('plan.milestones', this.projectId).catch(() => []),
    ]);
    this.tasks = tasks;
    this.milestones = milestones;
    this.loaded = true;
  }

  dispose(): void {
    this.stop();
  }
}
