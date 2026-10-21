import { SvelteMap } from 'svelte/reactivity';
import type { HistoryBlock, HistorySource, HistoryPage } from '../../../shared/history';
import { HistoryPageCache } from './history-page-cache';

/** Reactive publication of the data-only page cache, with the existing error behavior. */
export class HistoryPages {
  readonly blocks = new SvelteMap<number, HistoryBlock>();
  error = $state<string>();
  version = $state(0);
  loading = $state(false);
  private readonly cache: HistoryPageCache;
  constructor(
    onerror: (error: string) => void,
    onpage: (page: HistoryPage) => void,
    onrefresh: () => void,
  ) {
    this.cache = new HistoryPageCache({
      blocks: this.blocks,
      read: (source, start, limit) => window.skaro.invoke('history.page', source, start, limit),
      onpage,
      onstale: onrefresh,
      onerror: (error) => {
        this.error = error;
        if (error) onerror(error);
      },
      onchange: () => this.version++,
      onloading: (loading) => {
        this.loading = loading;
      },
    });
  }
  setSource(source: HistorySource): void {
    this.cache.setSource(source);
  }
  load(
    start: number,
    end: number,
    pinned: ReadonlySet<number>,
    visibleStart = start,
    visibleEnd = end,
  ): Promise<void> {
    return this.cache.load(start, end, pinned, visibleStart, visibleEnd);
  }
  position(id: string): number {
    for (const [index, block] of this.blocks) if (block.id === id) return index;
    return -1;
  }
  seed(page: HistoryPage): void {
    this.cache.seed(page);
  }
}
