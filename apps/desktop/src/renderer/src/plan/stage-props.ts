import type { ProjectTasks } from '../tasks/data.svelte';
import type { StageInfo, TaskSummary } from '../../../shared/ipc';
import type { Stage } from './model';
import type { PlanDrag } from './plan-drag.svelte';

export type StageProps = {
  stage: Stage;
  projectId: string;
  data: ProjectTasks;
  open: boolean;
  /** A group of the archive: no dragging, "Вернуть из архива" instead of the plan actions. */
  archived?: boolean;
  /** The copy under the pointer while the milestone is dragged. */
  ghost?: boolean;
  hovered?: string;
  up: Set<string>;
  down: Set<string>;
  drag?: PlanDrag;
  /** The milestone or task just put down: it plays the landing. */
  dropped?: string;
  now: number;
  canArchive: boolean;
  canDelete: boolean;
  /** Where the stage stands; absent for "Без этапа" and in the archive. */
  info?: StageInfo | undefined;
  /** «Запустить», «Продолжить», «Остановить». */
  onrun?: (action: 'run' | 'stop') => void;
  ontoggle: () => void;
  onmenu: (action: 'open' | 'discuss' | 'archive' | 'restore' | 'delete') => void;
  onhover: (id: string | undefined) => void;
  onopen: (taskId: string) => void;
  onrestore?: (taskId: string) => void;
  ondown: (
    kind: PlanDrag['kind'],
    id: string,
    from: string,
    e: PointerEvent,
    task?: TaskSummary,
    dependencies?: import('../../../shared/plan-catalog').TaskLink[],
  ) => void;
  onkey: (
    kind: PlanDrag['kind'],
    id: string,
    from: string,
    e: KeyboardEvent,
    task?: TaskSummary,
    dependencies?: import('../../../shared/plan-catalog').TaskLink[],
  ) => void;
};
