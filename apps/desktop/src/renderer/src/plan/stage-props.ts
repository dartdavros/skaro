import type { TaskSummary } from '../../../shared/ipc';
import type { Stage } from './model';
import type { PlanDrag } from './plan-drag.svelte';

export type StageProps = {
  stage: Stage;
  open: boolean;
  /** A group of the archive: no dragging, "Вернуть из архива" instead of the plan actions. */
  archived?: boolean;
  /** The copy under the pointer while the milestone is dragged. */
  ghost?: boolean;
  hovered?: string;
  up: Set<string>;
  down: Set<string>;
  byId: Map<string, TaskSummary>;
  drag?: PlanDrag;
  /** The milestone or task just put down: it plays the landing. */
  dropped?: string;
  now: number;
  canArchive: boolean;
  canDelete: boolean;
  ontoggle: () => void;
  onmenu: (action: 'discuss' | 'archive' | 'restore' | 'delete') => void;
  onhover: (id: string | undefined) => void;
  onopen: (taskId: string) => void;
  onrestore?: (taskId: string) => void;
  ondown: (kind: PlanDrag['kind'], id: string, from: string, e: PointerEvent) => void;
  onkey: (kind: PlanDrag['kind'], id: string, from: string, e: KeyboardEvent) => void;
};
