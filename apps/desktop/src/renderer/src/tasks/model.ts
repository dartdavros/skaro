// "Задачи" (Tasks mockup): statuses as the board shows them, columns, filters and list groups.

import { t } from '@skaro/ui';
import type { AgentId, TaskStatus, TaskSummary } from '../../../shared/ipc';

/** The eight statuses of the mockup; "queued" counts as "В работе" everywhere but its label. */
export type BoardStatus =
  'todo' | 'blocked' | 'working' | 'need' | 'review' | 'done' | 'error' | 'cancelled';

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

export function boardStatus(status: TaskStatus): BoardStatus {
  switch (status) {
    case 'in_progress':
    case 'queued':
      return 'working';
    case 'needs_answer':
      return 'need';
    case 'failed':
      return 'error';
    default:
      return status;
  }
}

export function statusLabel(status: TaskStatus): string {
  return t(`task.status.${status}`);
}

export const AGENT_NAMES: Record<AgentId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};

/** "Claude Code · Opus 5", or "—" when no agent is assigned. */
export function agentLine(task: TaskSummary): string {
  if (!task.agent) return '—';
  return task.model ? `${AGENT_NAMES[task.agent]} · ${task.model}` : AGENT_NAMES[task.agent];
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
 * The column a task belongs to; a failed task stays where it failed (in progress, in review).
 * A cancelled task has no column.
 */
export function columnOf(task: TaskSummary): Column['key'] | undefined {
  switch (boardStatus(task.status)) {
    case 'cancelled':
      return undefined;
    case 'todo':
    case 'blocked':
      return 'todo';
    case 'error':
      return task.stage === 'review' ? 'review' : 'working';
    case 'review':
      return 'review';
    case 'done':
      return 'done';
    default:
      return 'working';
  }
}

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
  // Tasks without a milestone close the list as "Без этапа" (D-32).
  const all = shown.some((x) => !x.milestone)
    ? [...milestones, { id: '', title: looseTitle }]
    : milestones;
  return all
    .map((m) => {
      const own = shown.filter((x) => (x.milestone?.id ?? '') === m.id);
      return {
        id: m.id,
        title: m.title,
        done: own.filter((x) => x.status === 'done').length,
        total: own.length,
        tasks: own,
      };
    })
    .filter((g) => g.tasks.length > 0);
}

export { canStart } from './task-rules';

export function needsYou(task: TaskSummary): boolean {
  return task.status === 'needs_answer' || task.status === 'review';
}

const ACTIVE_ORDER = { need: 0, review: 1, working: 2 } as const;

/**
 * "Активные" of the left panel: tasks that need an answer, then in review, then running or
 * queued; archived ones are left out.
 */
export function activeTasks(
  tasks: TaskSummary[],
): { task: TaskSummary; kind: keyof typeof ACTIVE_ORDER }[] {
  const kindOf = (task: TaskSummary): keyof typeof ACTIVE_ORDER | undefined =>
    task.status === 'needs_answer'
      ? 'need'
      : task.status === 'review'
        ? 'review'
        : task.status === 'in_progress' || task.status === 'queued'
          ? 'working'
          : undefined;
  return tasks
    .filter((task) => !task.archived)
    .flatMap((task) => {
      const kind = kindOf(task);
      return kind ? [{ task, kind }] : [];
    })
    .sort((a, b) => ACTIVE_ORDER[a.kind] - ACTIVE_ORDER[b.kind]);
}

export type BulkKind = 'delete' | 'archive' | 'move' | 'unblock';
export type BulkAction = BulkKind | 'run' | 'assign';
