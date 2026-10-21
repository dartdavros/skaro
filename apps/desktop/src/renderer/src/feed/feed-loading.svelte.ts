import { getContext, setContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';

const key = Symbol('feed-loading');

/** One visual loading boundary for the visible feed, including nested Markdown. */
export class FeedLoading {
  private readonly pending = new SvelteSet<symbol>();
  get busy(): boolean {
    return this.pending.size > 0;
  }
  track(id: symbol, busy: boolean): void {
    if (busy) this.pending.add(id);
    else this.pending.delete(id);
  }
}

export function provideFeedLoading(): FeedLoading {
  const loading = new FeedLoading();
  setContext(key, loading);
  return loading;
}

export function useFeedLoading(): FeedLoading | undefined {
  return getContext(key);
}
