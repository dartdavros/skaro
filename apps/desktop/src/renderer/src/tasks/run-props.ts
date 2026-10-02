import type { TaskSummary, TaskAssignment } from '../../../shared/ipc';
export type RunProps = {
  projectId: string;
  tasks: TaskSummary[];
  onconfirm: (assignment?: TaskAssignment) => void;
  onclose: () => void;
};
