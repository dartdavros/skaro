import type { ProjectInfo } from '../../../shared/ipc';
export type ProjectParamsProps = {
  project: ProjectInfo;
  onremove: () => void;
  onchanged: () => void;
};
