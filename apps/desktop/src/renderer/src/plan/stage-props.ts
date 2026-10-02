import type { TaskSummary } from '../../../shared/ipc';
import type { Drag, Over, Stage } from './model';

export type StageProps = {
  stage: Stage;
  index: number;
  open: boolean;
  hideDone: boolean;
  hovered?: string;
  up: Set<string>;
  down: Set<string>;
  byId: Map<string, TaskSummary>;
  drag?: Drag;
  over?: Over;
  now: number;
  ontoggle: () => void;
  onmenu: (action: 'newTask' | 'edit' | 'discuss' | 'delete') => void;
  onhover: (id: string | undefined) => void;
  onopen: (taskId: string) => void;
  ondrag: (drag: Drag | undefined) => void;
  onover: (over: Over) => void;
  ondrop: () => void;
};
