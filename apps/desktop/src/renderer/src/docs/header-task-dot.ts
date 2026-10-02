import type { TaskStatus } from '../../../shared/ipc';

export function taskDot(status: TaskStatus): { color: string; pulse: boolean } {
  if (status === 'done') return { color: 'var(--sk-text-13)', pulse: false };
  if (status === 'in_progress' || status === 'queued')
    return { color: 'var(--sk-fill-41)', pulse: true };
  if (status === 'review' || status === 'needs_answer')
    return { color: 'var(--sk-accent)', pulse: false };
  if (status === 'failed') return { color: 'var(--sk-error)', pulse: false };
  return { color: 'var(--sk-fill-36)', pulse: false };
}
