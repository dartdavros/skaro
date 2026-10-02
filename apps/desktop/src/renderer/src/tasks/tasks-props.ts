import type { ProjectTasks } from './data.svelte';
export type TasksProps = {
  projectId: string;
  /** Tasks and milestones of the project, shared with the sections panel. */
  data: ProjectTasks;
  onopen: (taskId: string) => void;
  /** "Новая задача": tasks are created with the agent in a new chat. */
  onnew: () => void;
};
