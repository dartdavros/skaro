import type { AgentInfo, ProjectInfo } from '../../../shared/ipc';
export type ChatScreenProps = {
  project: ProjectInfo;
  agents: AgentInfo[];
  /** Open chat; `NEW_CHAT` for the start screen of a new one, undefined to pick the latest. */
  chat?: string | undefined;
  onsection: (section: 'plan' | 'docs' | 'tasks') => void;
  /** "Импортировать документацию". */
  onimport: () => void;
};
