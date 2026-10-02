import type { ProjectInfo } from '../../../shared/ipc';
export type NewProjectProps = { open?: boolean; oncreated: (project: ProjectInfo) => void };
export type NewProjectContext = NewProjectProps & { open: boolean };
