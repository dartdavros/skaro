import { agentName } from '@skaro/agents/catalog';
// "Задачи" (Tasks mockup): statuses as the board shows them, columns, filters and list groups.

import { t } from '@skaro/ui';
import type { MergeProgress, TaskStatus, TaskSummary } from '../../../shared/ipc';

/** The eight statuses of the mockup; "queued" counts as "В работе" everywhere but its label. */
import { activeKind, boardStatus, columnOf, needsYou } from '../../../shared/task-presentation';
import type { BoardStatus } from '../../../shared/task-presentation';
export { boardStatus, columnOf, needsYou };
export type { BoardStatus };

export const STATUS_META: Record<BoardStatus, { label: string; color: string }> = {
  todo: { label: 'task.status.todo', color: 'var(--sk-text-15)' },
  blocked: { label: 'task.status.blocked', color: 'var(--sk-text-15)' },
  working: { label: 'task.status.in_progress', color: 'var(--sk-blue-3)' },
  need: { label: 'task.status.needs_answer', color: 'var(--sk-accent)' },
  review: { label: 'task.status.review', color: 'var(--sk-accent)' },
  done: { label: 'task.status.done', color: 'var(--sk-text-15)' },
  error: { label: 'task.status.failed', color: 'var(--sk-red-2)' },
  cancelled: { label: 'task.status.cancelled', color: 'var(--sk-text-22)' },
};

export const STATUS_ORDER: BoardStatus[] = [
  'todo',
  'blocked',
  'working',
  'need',
  'review',
  'done',
  'error',
  'cancelled',
];

export function statusLabel(status: TaskStatus): string {
  return t(`task.status.${status}`);
}

/** "Claude Code · Opus 5", or "—" when no agent is assigned. */
export function agentLine(task: TaskSummary): string {
  if (!task.agent) return '—';
  return task.model ? `${agentName(task.agent)} · ${task.model}` : agentName(task.agent);
}

export interface Filters {
  query: string;
  milestones: string[];
  statuses: BoardStatus[];
  /** Agent ids, 'none' for tasks without one. */
  agents: string[];
}

export function applyFilters(tasks: TaskSummary[], f: Filters): TaskSummary[] {
  const q = f.query.trim().toLowerCase();
  return tasks.filter(
    (task) =>
      (!f.milestones.length || f.milestones.includes(task.milestone?.id ?? '')) &&
      (!f.statuses.length || f.statuses.includes(boardStatus(task.status))) &&
      (!f.agents.length || f.agents.includes(task.agent ?? 'none')) &&
      (!q || `${task.id} ${task.title}`.toLowerCase().includes(q)),
  );
}

export interface Column {
  key: 'todo' | 'working' | 'review' | 'done';
  color: string;
  tasks: TaskSummary[];
}

/**
 * The column a task belongs to; a failed task stays in the column of its stage (the main process
 * never shows a task in review as failed). A cancelled task has no column.
 */
/**
 * Four columns: not started (with blocked), in progress, in review, done. `moved` puts tasks
 * dropped on another column there until their status catches up (or the move fails).
 */
export function columns(
  tasks: TaskSummary[],
  moved: Partial<Record<string, Column['key']>> = {},
): Column[] {
  const of = (key: Column['key']) => tasks.filter((x) => (moved[x.id] ?? columnOf(x)) === key);
  return [
    { key: 'todo', color: 'var(--sk-text-13)', tasks: of('todo') },
    { key: 'working', color: 'var(--sk-text-13)', tasks: of('working') },
    { key: 'review', color: 'var(--sk-text-13)', tasks: of('review') },
    { key: 'done', color: 'var(--sk-text-13)', tasks: of('done') },
  ];
}

export interface Group {
  id: string;
  title: string;
  done: number;
  total: number;
  tasks: TaskSummary[];
}

/** List view: one group per milestone in plan order, counts over the filtered tasks. */
export function groups(
  shown: TaskSummary[],
  milestones: { id: string; title: string }[],
  looseTitle = '',
): Group[] {
  const byMilestone = new Map<string, TaskSummary[]>();
  for (const task of shown) {
    const id = task.milestone?.id ?? '';
    const own = byMilestone.get(id) ?? [];
    own.push(task);
    byMilestone.set(id, own);
  }
  const all = byMilestone.has('') ? [...milestones, { id: '', title: looseTitle }] : milestones;
  return all.flatMap((m) => {
    const own = byMilestone.get(m.id);
    return own
      ? [
          {
            id: m.id,
            title: m.title,
            done: own.filter((task) => task.status === 'done').length,
            total: own.length,
            tasks: own,
          },
        ]
      : [];
  });
}

export { canStart } from './task-rules';

/** How the merge of a finished task goes: `note` after the milestone id, `tip` on its mark. */
export function mergeWords(task: TaskSummary): { note: string; tip: string } | undefined {
  if (!task.merge) return undefined;
  const key = mergeKey(task.merge, task.status);
  return { note: t(`board.stage.merge.${key}`), tip: t(`board.merge.${key}`) };
}

/** The agent of the task resolves its conflict only while it works on the task. */
export function mergeKey(merge: MergeProgress, status: TaskStatus): string {
  return merge === 'conflict' && status !== 'in_progress' ? 'conflict.idle' : merge;
}

const ACTIVE_ORDER = { need: 0, review: 1, working: 2 } as const;

/**
 * "Активные" of the left panel: tasks that need an answer, then in review, then running or
 * queued; archived ones are left out.
 */
export function activeTasks(
  tasks: TaskSummary[],
): { task: TaskSummary; kind: keyof typeof ACTIVE_ORDER }[] {
  return tasks
    .filter((task) => !task.archived)
    .flatMap((task) => {
      const kind = activeKind(task);
      return kind ? [{ task, kind }] : [];
    })
    .sort((a, b) => ACTIVE_ORDER[a.kind] - ACTIVE_ORDER[b.kind]);
}

export type BulkKind = 'delete' | 'archive' | 'move' | 'unblock';
export type BulkAction = BulkKind | 'run' | 'assign';
