import type { ProjectTasks } from '../tasks/data.svelte';

export type PlanProps = {
  projectId: string;
  data: ProjectTasks;
  onopen: (taskId: string) => void;
  /** A new chat with the agent (replanning, a new task, discussing a milestone). */
  onchat: () => void;
};
