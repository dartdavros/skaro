// State of the diff window: which file, expanded or not, the turn's diff or a refreshed one.

import type { TurnFile } from '@skaro/timeline';
import { t } from '@skaro/ui';
import type { FileDiff } from '../../../shared/ipc';
import { highlightDiff, type Segment } from './diff-highlight';
import { diffCounts, numberedDiffLines } from './diff-model';

const CODE =
  /\.(c|cc|cjs|cpp|cs|css|go|h|hpp|html|java|js|json|jsx|kt|mjs|php|py|rb|rs|scss|sh|sql|swift|ts|tsx)$/i;

export function isCodePath(path: string): boolean {
  return CODE.test(path);
}

export function createDiffModalController(options: {
  files: () => TurnFile[];
  start: () => number;
  /** The file's current changes in the working folder ("Обновить"). */
  load: (path: string) => Promise<FileDiff>;
}) {
  // svelte-ignore state_referenced_locally
  let index = $state(options.start());
  let expanded = $state(false);
  let spin = $state(0);
  let refreshing = $state(false);
  /** Refreshed diffs by path; the turn's own diff until "Обновить". */
  let fresh = $state<Record<string, FileDiff>>({});
  let colors = $state<(Segment[] | undefined)[] | undefined>();

  const file = $derived(options.files()[index]!);
  const refreshed = $derived(fresh[file.path]);
  const change = $derived.by(() => {
    if (!refreshed) return file.change;
    if (refreshed.status === 'added') return 'add' as const;
    if (refreshed.status === 'deleted') return 'delete' as const;
    return file.change === 'move' ? ('move' as const) : ('update' as const);
  });
  const lines = $derived(
    numberedDiffLines(refreshed ? (refreshed.diff ? [refreshed.diff] : []) : file.diffs, change),
  );
  const counts = $derived.by(() => {
    if (!refreshed && (file.added !== undefined || file.removed !== undefined))
      return { added: file.added ?? 0, removed: file.removed ?? 0 };
    return diffCounts(lines);
  });

  // Colours arrive after the lines; a newer file or diff replaces older colours.
  $effect(() => {
    const current = lines;
    const path = file.movePath ?? file.path;
    colors = undefined;
    let stale = false;
    void highlightDiff(path, current)
      .then((result) => {
        if (!stale) colors = result;
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  });

  function go(next: number): void {
    const count = options.files().length;
    if (next >= 0 && next < count) index = next;
  }

  async function refresh(): Promise<void> {
    const path = file.path;
    spin += 360;
    refreshing = true;
    try {
      const diff = await options.load(path);
      fresh = { ...fresh, [path]: diff };
    } catch {
      // The turn's diff stays; the status line says nothing changed.
    } finally {
      refreshing = false;
    }
  }

  return {
    get index() {
      return index;
    },
    get file() {
      return file;
    },
    get change() {
      return change;
    },
    get lines() {
      return lines;
    },
    get colors() {
      return colors;
    },
    get counts() {
      return counts;
    },
    get expanded() {
      return expanded;
    },
    set expanded(value: boolean) {
      expanded = value;
    },
    get spin() {
      return spin;
    },
    get refreshing() {
      return refreshing;
    },
    get unchanged() {
      return refreshed?.status === 'unchanged';
    },
    get sub() {
      return refreshing
        ? t('diff.refreshing')
        : refreshed
          ? t('diff.refreshed')
          : t('diff.subtitle');
    },
    go,
    refresh,
  };
}
