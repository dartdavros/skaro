import type { TaskAssignment } from '../../../shared/ipc';
export type AssignmentProps = {
  projectId: string;
  count: number;
  onconfirm: (assignment: TaskAssignment) => void;
  onclose: () => void;
};
