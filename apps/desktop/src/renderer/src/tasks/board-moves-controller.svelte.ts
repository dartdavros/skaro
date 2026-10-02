// What a drop on the board does: the card's new place is kept, a move to another column runs
// the task action at once on screen and is rolled back if it fails or is cancelled.

import { t } from '@skaro/ui';
import type { TaskAssignment, TaskSummary } from '../../../shared/ipc';
import { moveOf, type ColumnKey } from './board-moves';
import { arrange, boardOrderKey, placed, type BoardOrder } from './board-order';
import { columnOf, columns, type Column } from './model';

export function createBoardMoves(p: {
  projectId: () => string;
  tasks: () => TaskSummary[];
  onopen: (id: string) => void;
}) {
  let order = $state<BoardOrder>({});
  /** Cards shown in another column while their action runs. */
  let moved = $state<Partial<Record<string, ColumnKey>>>({});
  /** The task whose launch dialog is open after a drop on "В работе". */
  let starting = $state<{ task: TaskSummary; done: (ok: boolean) => void } | undefined>();

  $effect(() => {
    void window.skaro
      .invoke('app.getSetting', boardOrderKey(p.projectId()))
      .then((v) => (order = (v as BoardOrder | null) ?? {}))
      .catch(() => undefined);
  });

  // A moved card goes back to its own column once its status shows the move (or it is gone).
  $effect(() => {
    const ids = Object.keys(moved);
    if (!ids.length) return;
    const next = { ...moved };
    let changed = false;
    for (const id of ids) {
      const task = p.tasks().find((x) => x.id === id);
      if (!task || columnOf(task) === next[id]) {
        delete next[id];
        changed = true;
      }
    }
    if (changed) moved = next;
  });

  const cols = $derived<Column[]>(
    columns(p.tasks(), moved).map((c) => ({ ...c, tasks: arrange(c.tasks, order[c.key]) })),
  );

  function back(id: string): void {
    const next = { ...moved };
    delete next[id];
    moved = next;
  }

  function place(to: ColumnKey, task: TaskSummary, index: number): void {
    const ids = (cols.find((c) => c.key === to)?.tasks ?? []).map((x) => x.id);
    order = { ...order, [to]: placed(ids, task.id, index) };
    void window.skaro.invoke(
      'app.setSetting',
      boardOrderKey(p.projectId()),
      $state.snapshot(order),
    );
  }

  /** Opens the launch dialog for one task; true when it was started. */
  function askStart(task: TaskSummary): Promise<boolean> {
    return new Promise((done) => (starting = { task, done }));
  }

  async function act(task: TaskSummary, to: ColumnKey, run: () => Promise<unknown>): Promise<void> {
    moved = { ...moved, [task.id]: to };
    try {
      if ((await run()) === false) back(task.id);
    } catch {
      back(task.id);
    }
  }

  function drop(task: TaskSummary, from: ColumnKey, to: ColumnKey, index: number): void {
    const move = moveOf(task, from, to);
    if (!move) return;
    place(to, task, index);
    const id = p.projectId();
    if (move === 'start') void act(task, to, () => askStart(task));
    if (move === 'cancel')
      void act(task, to, () => window.skaro.invoke('tasks.cancel', id, task.id));
    if (move === 'merge')
      void act(task, to, async () => {
        if ((await window.skaro.invoke('tasks.merge', id, task.id)) === 'merged') return true;
        // A blocked merge or no card: the user decides on the card in the task's feed.
        p.onopen(task.id);
        return false;
      });
  }

  async function confirmStart(assignment?: TaskAssignment): Promise<void> {
    const s = starting;
    starting = undefined;
    if (!s) return;
    try {
      await window.skaro.invoke(
        'tasks.run',
        p.projectId(),
        [s.task.id],
        t('task.start.message'),
        ...(assignment ? [assignment] : []),
      );
      s.done(true);
    } catch {
      s.done(false);
    }
  }

  function closeStart(): void {
    starting?.done(false);
    starting = undefined;
  }

  return {
    get columns() {
      return cols;
    },
    get starting() {
      return starting?.task;
    },
    allowed: (task: TaskSummary, from: ColumnKey, to: ColumnKey) =>
      moveOf(task, from, to) !== undefined,
    drop,
    confirmStart,
    closeStart,
  };
}

export type BoardMoves = ReturnType<typeof createBoardMoves>;
