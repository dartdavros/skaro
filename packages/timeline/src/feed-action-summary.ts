import { actionItems, type ActionGroup } from './feed-groups.ts';
import type { Item } from './model.ts';

export type ActionKind =
  | 'file'
  | 'read'
  | 'command'
  | 'search'
  | 'web'
  | 'fetch'
  | 'reconnect'
  | 'tool'
  | 'task'
  | 'image'
  | 'generated'
  | 'list';
export interface ActionSummary {
  kind: ActionKind;
  count: number;
  running: boolean;
  pending: boolean;
  performed: boolean;
  progress?: { attempt: number; max: number };
}

/** Codex puts the reconnect attempt in its native message; Claude supplies structured retry data. */
export function reconnectionProgress(item: Item): { attempt: number; max: number } | undefined {
  if (item.kind !== 'notice' || item.code !== 'retry') return undefined;
  if (item.retry) return { attempt: item.retry.attempt, max: item.retry.max };
  const match = /^Reconnecting\.\.\.\s+(\d+)\/(\d+)/i.exec(item.text);
  return match ? { attempt: Number(match[1]), max: Number(match[2]) } : undefined;
}

function kindOf(item: Item): ActionKind | undefined {
  switch (item.kind) {
    case 'file_change':
      return 'file';
    case 'command':
      return 'command';
    case 'tool':
      return 'tool';
    case 'task':
      return 'task';
    case 'image':
      return item.source === 'generated' ? 'generated' : 'image';
    case 'explore':
      return item.op === 'web'
        ? 'web'
        : item.op === 'search'
          ? 'search'
          : item.op === 'fetch'
            ? 'fetch'
            : item.op === 'list'
              ? 'list'
              : item.image
                ? 'image'
                : 'read';
    case 'notice':
      return item.code === 'retry' || item.code === 'session_restored' ? 'reconnect' : undefined;
    default:
      return undefined;
  }
}

/** Count underlying actions rather than already-compressed rows; do not double-count multi-file items. */
export function actionGroupSummary(group: ActionGroup): ActionSummary[] {
  const counts = new Map<ActionKind, ActionSummary>();
  const seen = new Set<string>();
  for (const item of group.rows.flatMap(actionItems)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const kind = kindOf(item);
    if (!kind) continue;
    const part: ActionSummary = counts.get(kind) ?? {
      kind,
      count: 0,
      running: false,
      pending: false,
      performed: false,
    };
    part.count += item.kind === 'file_change' ? item.files.length : 1;
    part.running ||= item.status === 'running';
    part.pending ||= item.status === 'queued';
    part.performed ||= item.status === 'done' || item.status === 'failed';
    const progress = reconnectionProgress(item);
    if (progress) part.progress = progress;
    counts.set(kind, part);
  }
  return [...counts.values()];
}

/** Ties use the first encountered action, so the icon is deterministic during streaming. */
export function dominantAction(parts: readonly ActionSummary[]): ActionKind {
  if (!parts.length) return 'command';
  const counts = new Map<ActionKind, number>();
  for (const part of parts) {
    const kind = part.kind === 'web' || part.kind === 'fetch' ? 'search' : part.kind;
    counts.set(kind, (counts.get(kind) ?? 0) + part.count);
  }
  return [...counts].reduce((best, part) => (part[1] > best[1] ? part : best))[0];
}
