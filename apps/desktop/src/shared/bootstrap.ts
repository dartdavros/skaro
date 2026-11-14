import type { ChatView, TaskView, ProjectInfo, ProjectCard, TabsState } from './ipc-sessions';
import type { ShutdownState } from './shutdown';

export interface WorkspaceState {
  view: 'home' | 'project' | 'settings' | 'inventory';
  sections: Record<string, string>;
  openTasks: Record<string, string | undefined>;
  openChats: Record<string, string | undefined>;
}

export interface BootstrapState {
  shutdown?: ShutdownState;
  chatCatalog?: import('./chat-catalog').ChatCatalog;
  sessions?: Record<string, ChatView | TaskView>;
  projectsView?: {
    query?: string;
    sort?: import('./project-catalog').ProjectSort;
    view?: 'grid' | 'list';
  };
  locale: 'ru' | 'en';
  projects: ProjectInfo[];
  tabs: TabsState;
  workspace?: WorkspaceState;
  cards: ProjectCard[];
  feedFont?: string;
  panelCollapsed: boolean;
}
