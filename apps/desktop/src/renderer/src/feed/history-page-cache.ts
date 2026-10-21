import {
  historyContentRevision,
  type HistoryBlock,
  type HistoryPage,
  type HistorySource,
} from '../../../shared/history';

const SIZE = 16;
interface CacheInput {
  blocks: Map<number, HistoryBlock>;
  read(source: HistorySource, start: number, limit: number): Promise<HistoryPage>;
  onpage(page: HistoryPage): void;
  onerror(error?: string): void;
  onchange(): void;
  onloading?(loading: boolean): void;
  onstale?(): void;
}
function sameContent(a: HistorySource | undefined, b: HistorySource): boolean {
  return (
    !!a &&
    a.owner === b.owner &&
    a.key === b.key &&
    a.count === b.count &&
    historyContentRevision(a) === historyContentRevision(b)
  );
}

/** Data-only page lifecycle; control updates preserve cached and in-flight row content. */
export class HistoryPageCache {
  private source?: HistorySource;
  private generation = 0;
  private refreshing = false;
  private readonly loaded = new Map<number, number>();
  private readonly pending = new Map<number, Promise<void>>();
  private readonly failed = new Set<number>();
  private readonly input: CacheInput;
  constructor(input: CacheInput) {
    this.input = input;
  }

  setSource(source: HistorySource): void {
    // A genuine refreshed view retries failed pages without invalidating successful ones.
    if (this.source !== source) {
      this.refreshing = false;
      for (const page of this.failed) this.loaded.delete(page);
      this.failed.clear();
    }
    if (this.source?.owner !== source.owner || this.source.key !== source.key) {
      this.input.blocks.clear();
      this.loaded.clear();
    }
    if (!sameContent(this.source, source)) {
      this.generation++;
      this.pending.clear();
      this.input.onloading?.(false);
    }
    this.source = source;
    for (const index of this.input.blocks.keys())
      if (index >= source.count) this.input.blocks.delete(index);
  }

  async load(
    start: number,
    end: number,
    pinned: ReadonlySet<number>,
    visibleStart = start,
    visibleEnd = end,
  ): Promise<void> {
    const source = this.source;
    if (!source) return;
    const generation = this.generation;
    const needed = new Set<number>();
    for (let i = visibleStart; i < visibleEnd; i++) needed.add(Math.floor(i / SIZE) * SIZE);
    for (let i = start; i < end; i++) needed.add(Math.floor(i / SIZE) * SIZE);
    for (const index of pinned) needed.add(Math.floor(index / SIZE) * SIZE);
    for (const page of needed) {
      if (generation !== this.generation) return;
      if (this.loaded.get(page) === historyContentRevision(source)) continue;
      await this.request(source, page, generation);
    }
    if (generation !== this.generation) return;
    for (const page of this.loaded.keys()) {
      if (this.loaded.size <= 12) break;
      if (needed.has(page)) continue;
      this.loaded.delete(page);
      for (let i = page; i < page + SIZE; i++) this.input.blocks.delete(i);
    }
  }

  private request(source: HistorySource, page: number, generation: number): Promise<void> {
    const pending = this.pending.get(page);
    if (pending) return pending;
    const work = (async () => {
      try {
        const result = await this.input.read(source, page, SIZE);
        if (generation !== this.generation) return;
        // Wait for the matching header announcement instead of mixing structural revisions.
        if (!sameContent(this.source, result.source)) {
          this.loaded.set(page, historyContentRevision(source));
          if (!this.refreshing) {
            this.refreshing = true;
            this.input.onstale?.();
          }
          return;
        }
        if (result.start !== page || result.blocks.length !== Math.min(SIZE, source.count - page))
          throw new Error('History page is incomplete; reload the conversation to retry.');
        result.blocks.forEach((block, offset) =>
          this.input.blocks.set(result.start + offset, block),
        );
        this.loaded.delete(page);
        this.loaded.set(page, historyContentRevision(result.source));
        this.failed.delete(page);
        this.input.onpage(result);
        if (!this.failed.size) this.input.onerror();
      } catch (error) {
        if (generation === this.generation) {
          this.loaded.set(page, historyContentRevision(source));
          this.failed.add(page);
          this.input.onerror(String(error));
        }
      }
    })();
    const request: Promise<void> = work.finally(() => {
      if (generation === this.generation && this.pending.get(page) === request) {
        this.pending.delete(page);
        this.input.onloading?.(this.pending.size > 0);
        this.input.onchange();
      }
    });
    this.pending.set(page, request);
    this.input.onloading?.(true);
    return request;
  }

  seed(page: HistoryPage): void {
    const source = this.source;
    if (!source || !sameContent(source, page.source)) return;
    const revision = historyContentRevision(source);
    page.blocks.forEach((block, index) => {
      const at = page.start + index;
      if (
        this.failed.has(Math.floor(at / SIZE) * SIZE) ||
        this.loaded.get(Math.floor(at / SIZE) * SIZE) !== revision
      )
        this.input.blocks.set(at, block);
    });
    for (
      let at = Math.ceil(page.start / SIZE) * SIZE;
      at < page.start + page.blocks.length;
      at += SIZE
    )
      if (Math.min(at + SIZE, source.count) <= page.start + page.blocks.length) {
        this.loaded.set(at, revision);
        this.failed.delete(at);
      }
  }
}
