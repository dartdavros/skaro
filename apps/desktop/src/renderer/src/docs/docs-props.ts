import type { ProjectTasks } from '../tasks/data.svelte';

export type DocsProps = {
  projectId: string;
  /** A document to show first: a task's specification. */
  open?: string | undefined;
  /** The project's tasks, for the "Задачи" block of a specification. */
  tasks: ProjectTasks;
  onchat: () => void;
  ontask: (id: string) => void;
  /** "Импортировать документацию". */
  onimport: () => void;
};
