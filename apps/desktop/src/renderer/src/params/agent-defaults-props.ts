import type { ProjectSettings } from '../../../shared/ipc';
export type AgentDefaultsProps = {
  projectId: string;
  settings: ProjectSettings;
  onchange: (patch: Partial<ProjectSettings>) => void;
};
