import type { TaskSummary } from '../../../shared/ipc';
import { doneLike, rowStatus, type Drag } from './model';
import type { StageProps } from './stage-props';

export function createStageController(getProps: () => StageProps) {
  const p = $derived(getProps());
  const m = $derived(p.stage.milestone);
  const shown = $derived(
    p.stage.tasks.filter((x) => !(p.hideDone && doneLike(rowStatus(x.status)))),
  );
  const pct = $derived(p.stage.total ? Math.round((p.stage.done / p.stage.total) * 100) : 0);
  const finished = $derived(p.stage.total > 0 && p.stage.done === p.stage.total);
  const end = $derived(p.stage.tasks.length);
  const endOver = $derived(
    p.drag?.kind === 'task' &&
      p.over?.kind === 'task' &&
      p.over.stage === m.id &&
      p.over.index === end,
  );
  const stageOver = $derived(
    p.drag?.kind === 'stage' &&
      p.over?.kind === 'stage' &&
      p.over.index === p.index &&
      p.drag.id !== m.id,
  );

  function start(e: DragEvent, next: Drag): void {
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', next.id);
    }
    p.ondrag(next);
  }

  function overStage(e: DragEvent): void {
    if (!p.drag) return;
    e.preventDefault();
    p.onover(
      p.drag.kind === 'stage'
        ? { kind: 'stage', index: p.index }
        : { kind: 'task', stage: m.id, index: end },
    );
  }

  function overEnd(e: DragEvent): void {
    if (p.drag?.kind !== 'task') return;
    e.preventDefault();
    e.stopPropagation();
    p.onover({ kind: 'task', stage: m.id, index: end });
  }

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
    get shown() {
      return shown;
    },
    get pct() {
      return pct;
    },
    get finished() {
      return finished;
    },
    get end() {
      return end;
    },
    get endOver() {
      return endOver;
    },
    get stageOver() {
      return stageOver;
    },
    start,
    overStage,
    overEnd,
    relation,
  };
}

export type StageController = ReturnType<typeof createStageController>;
