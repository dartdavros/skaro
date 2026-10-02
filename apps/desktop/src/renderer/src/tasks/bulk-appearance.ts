import type { IconName } from '@skaro/ui';
import type { BulkKind } from './model';

export const BULK_LOOK: Record<
  BulkKind,
  { icon: IconName; bg: string; color: string; btn: string }
> = {
  delete: {
    icon: 'trashLines',
    bg: 'var(--sk-red-8)',
    color: 'var(--sk-error)',
    btn: 'var(--sk-red-7)',
  },
  archive: {
    icon: 'archive',
    bg: 'var(--sk-fill-20)',
    color: 'var(--sk-text-11)',
    btn: 'var(--sk-accent)',
  },
  move: {
    icon: 'folderPlus',
    bg: 'var(--sk-fill-20)',
    color: 'var(--sk-text-11)',
    btn: 'var(--sk-accent)',
  },
  unblock: {
    icon: 'unlock',
    bg: 'var(--sk-orange-3)',
    color: 'var(--sk-orange-1)',
    btn: 'var(--sk-accent)',
  },
};
