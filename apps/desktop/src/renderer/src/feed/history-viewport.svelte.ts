import { SvelteMap } from 'svelte/reactivity';
import { tick } from 'svelte';
import type { HistorySource, HistoryPage } from '../../../shared/history';
import { RangeWindow } from './range-window.svelte';
import { HistoryPages } from './history-pages.svelte';
import { FeedSelection } from './feed-selection.svelte';
import type { FeedActions } from './context.svelte';
import { historyPaint } from './history-paint.svelte';
import { layoutFrame } from '../layout-frame';

/** The viewport owns measurements and requests; row components retain their existing behavior. */
export class HistoryViewport {
  private readonly source: () => HistorySource;
  private readonly primary: () => boolean;
  private readonly feed: FeedActions;
  root = $state<HTMLDivElement>();
  readonly window: RangeWindow;
  readonly pages: HistoryPages;
  readonly selection: FeedSelection;
  private readonly retained = new SvelteMap<string, { index: number; id: string }>();
  private cancelFrame?: () => void;
  private identity = '';
  private starting = false;
  constructor(
    source: () => HistorySource,
    primary: () => boolean,
    feed: FeedActions,
    gap = 14,
    initial: () => HistoryPage | undefined = () => undefined,
  ) {
    this.source = source;
    this.primary = primary;
    this.feed = feed;
    this.window = new RangeWindow(180, gap);
    this.pages = new HistoryPages(
      (error) => feed.historyError?.(error),
      (page) => {
        if (this.primary()) feed.rememberHistoryPage?.(page);
      },
      () => feed.refreshHistory?.(),
    );
    this.selection = new FeedSelection({
      root: () => this.root,
      blocks: () => [],
      position: (id) => this.pages.position(id),
      enabled: () => this.primary(),
      track: () => true,
      text: () => '',
      copyAll: () => window.skaro.invoke('history.copy', this.source(), feed.pendingHistory?.()),
    });
    historyPaint(
      () =>
        this.primary() &&
        this.shown.some(
          ({ index, block }) =>
            index >= this.window.visibleStart &&
            index < this.window.visibleEnd &&
            block &&
            (block.type === 'actions' ||
              (block.row.type !== 'question' && (block.row.type !== 'user' || !block.row.hidden))),
        ),
    );
    $effect(() => {
      const source = this.source();
      this.pages.setSource(source);
      this.window.reset(source.count);
      const page = initial();
      if (page) this.pages.seed(page);
      const identity = `${source.owner}\0${source.key}`;
      if (identity !== this.identity) {
        this.identity = identity;
        this.starting = this.primary();
        this.window.update(
          this.primary() ? Math.max(0, this.window.offset(source.count) - 800) : 0,
          800,
        );
      }
    });
    $effect(() => {
      void this.pages.version;
      void this.source();
      void this.pages.load(
        this.window.start,
        this.window.end,
        this.pinned,
        this.window.visibleStart,
        this.window.visibleEnd,
      );
    });
    $effect(() => {
      const root = this.root;
      const scroller = root?.closest<HTMLElement>('.scroller');
      if (!root || !scroller) return;
      const observer = new ResizeObserver(this.soon);
      observer.observe(scroller);
      observer.observe(root);
      scroller.addEventListener('scroll', this.soon, { passive: true });
      root.addEventListener('feed-retain', this.retain);
      this.soon();
      return () => {
        observer.disconnect();
        this.cancelFrame?.();
        this.cancelFrame = undefined;
        scroller.removeEventListener('scroll', this.soon);
        root.removeEventListener('feed-retain', this.retain);
      };
    });
    $effect(() => {
      if (!this.primary()) return;
      feed.revealRow = (id) => {
        void this.reveal(id);
      };
      return () => {
        feed.revealRow = undefined;
      };
    });
  }
  get pinned(): Set<number> {
    // This temporary union has no reactive lifetime of its own.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const indices = new Set([...this.retained.values()].map((item) => item.index));
    const selected = this.selection.range;
    if (selected) for (let i = selected.start; i < selected.end; i++) indices.add(i);
    return indices;
  }
  get loading(): boolean {
    return (
      this.pages.loading &&
      !this.pages.error &&
      this.shown.some(
        ({ index, block }) =>
          !block && index >= this.window.visibleStart && index < this.window.visibleEnd,
      )
    );
  }
  get shown() {
    const indices = this.pinned;
    for (let i = this.window.start; i < this.window.end; i++) indices.add(i);
    let previous = -1;
    return [...indices]
      .filter((i) => i < this.source().count)
      .sort((a, b) => a - b)
      .map((index) => {
        const before =
          index > previous + 1
            ? Math.max(
                0,
                this.window.offset(index) - this.window.offset(previous + 1) - this.window.gap,
              )
            : 0;
        previous = index;
        return { index, block: this.pages.blocks.get(index), before };
      });
  }
  get bottom(): number {
    const end = this.shown.at(-1)?.index ?? -1;
    return end + 1 < this.source().count
      ? Math.max(
          0,
          this.window.offset(this.source().count) - this.window.offset(end + 1) - this.window.gap,
        )
      : 0;
  }
  private retain = (event: Event): void => {
    const { id, active } = (event as CustomEvent<{ id: string; active: boolean }>).detail;
    let element = event.target as HTMLElement;
    while (element.parentElement && element.parentElement !== this.root)
      element = element.parentElement;
    const index = Number(element.dataset['historyIndex']);
    const block = this.pages.blocks.get(index);
    if (active && block) this.retained.set(id, { index, id: block.id });
    else this.retained.delete(id);
  };
  soon = (): void => {
    this.cancelFrame ??= layoutFrame(this.update);
  };
  private update = (): (() => void) | undefined => {
    this.cancelFrame = undefined;
    const root = this.root,
      scroller = root?.closest<HTMLElement>('.scroller');
    if (!root || !scroller) return;
    const height = scroller.clientHeight;
    if (this.starting) {
      this.starting = false;
      const bottom = scroller.scrollHeight;
      const offset = Math.max(0, this.window.offset(this.source().count) - height);
      return () => {
        scroller.scrollTop = bottom;
        this.window.update(offset, height);
      };
    }
    const offset = scroller.getBoundingClientRect().top - root.getBoundingClientRect().top;
    return () => this.window.update(offset, height);
  };
  measure(element: HTMLElement, index: number) {
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.borderBoxSize[0]?.blockSize ?? entry?.contentRect.height;
      if (height !== undefined) {
        this.window.measure(index, height);
        this.soon();
      }
    });
    observer.observe(element);
    return {
      update: (value: number) => {
        index = value;
      },
      destroy: () => observer.disconnect(),
    };
  }
  private async reveal(id: string): Promise<void> {
    this.root?.dispatchEvent(new CustomEvent('feed-reveal', { bubbles: true }));
    try {
      const source = this.source();
      const index = await window.skaro.invoke('history.find', source, id);
      const scroller = this.root?.closest<HTMLElement>('.scroller');
      if (index < 0 || !scroller) return;
      const offset = this.window.offset(index);
      this.window.update(offset, scroller.clientHeight);
      scroller.scrollTop = offset;
      await this.pages.load(index, index + 1, this.pinned);
      await tick();
      requestAnimationFrame(() =>
        document.getElementById(`proposal-${id}`)?.scrollIntoView({ block: 'center' }),
      );
    } catch (error) {
      this.feed.historyError?.(String(error));
    }
  }
}
