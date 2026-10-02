import type { TaskSummary } from '../../../shared/ipc';
import type { StageProps } from './stage-props';

export function createStageController(getProps: () => StageProps) {
  const p = $derived(getProps());
  const m = $derived(p.stage.milestone);
  /** The milestone can be dragged: not "Без этапа", not in the archive. */
  const movable = $derived(!p.stage.loose && !p.archived && !p.ghost);
  // The dragged task leaves its list; its slot moves where it would land.
  const shown = $derived(
    p.stage.tasks.filter((x) => !(p.drag?.kind === 'task' && p.drag.id === x.id)),
  );
  const slot = $derived(p.drag?.kind === 'task' && p.drag.to === m.id ? p.drag : undefined);
  /** A task from another milestone would land here. */
  const over = $derived(!!slot && slot.from !== m.id);
  const pct = $derived(p.stage.total ? Math.round((p.stage.done / p.stage.total) * 100) : 0);
  const finished = $derived(p.stage.total > 0 && p.stage.done === p.stage.total);

  function relation(task: TaskSummary): 'up' | 'down' | 'self' | undefined {
    if (p.hovered === task.id) return 'self';
    return p.up.has(task.id) ? 'up' : p.down.has(task.id) ? 'down' : undefined;
  }

  return {
    get p() {
      return p;
    },
    get m() {
      return m;
    },
    get movable() {
      return movable;
    },
    get shown() {
      return shown;
    },
    get slot() {
      return slot;
    },
    get over() {
      return over;
    },
    get pct() {
      return pct;
    },
    get finished() {
      return finished;
    },
    relation,
  };
}

export type StageController = ReturnType<typeof createStageController>;
