import { expect, it } from 'vitest';
import { FeedLoading } from './feed-loading.svelte';

it('keeps a single feed loading state across overlapping history and text work', () => {
  const loading = new FeedLoading();
  const history = Symbol('history');
  const first = Symbol('first visible text');
  const second = Symbol('second visible text');
  loading.track(history, true);
  loading.track(first, true);
  loading.track(second, true);
  loading.track(history, false);
  loading.track(first, false);
  expect(loading.busy).toBe(true);
  // A failing/cancelled child releases its own work without clearing other children.
  loading.track(second, false);
  expect(loading.busy).toBe(false);
});
