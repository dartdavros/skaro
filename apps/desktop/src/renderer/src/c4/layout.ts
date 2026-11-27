import { getContext, onDestroy, setContext } from 'svelte';
import type { C4Model, C4View } from '@skaro/core/c4-view';
import { buildC4Graph, type C4Graph } from './graph';
import { layoutC4Graph } from './layout-engine';
import { waitForC4 } from './lifetime';

const contextKey = Symbol('C4 layout');

export function createC4Layout() {
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  const cache = new Map<string, Promise<C4Graph>>();
  const models = new WeakMap<C4Model, number>();
  const waiting: { resolve(): void; reject(error: unknown): void }[] = [];
  let serial = 0;
  let active = 0;

  async function run(model: C4Model, view: C4View): Promise<C4Graph> {
    if (active < 2) active++;
    else await new Promise<void>((resolve, reject) => waiting.push({ resolve, reject }));
    try {
      await waitForC4(document.fonts.ready, signal);
      const measure = document.createElement('canvas').getContext('2d');
      if (!measure) throw new Error('C4: text measurement is unavailable');
      measure.font = '14px "Nunito Sans Variable"';
      const graph = buildC4Graph(model, view, (label) => measure.measureText(label).width);
      return await layoutC4Graph(graph, view.kind === 'dynamic', signal);
    } finally {
      const next = waiting.shift();
      if (next) next.resolve();
      else active--;
    }
  }

  function layout(model: C4Model, view: C4View): Promise<C4Graph> {
    if (signal.aborted) return Promise.reject(signal.reason);
    const identity = models.get(model) ?? ++serial;
    models.set(model, identity);
    const key = JSON.stringify([identity, view.id]);
    const existing = cache.get(key);
    if (existing) return existing;
    const pending = run(model, view).catch((error) => {
      if (cache.get(key) === pending) cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
    if (cache.size > 32) cache.delete(cache.keys().next().value!);
    return pending;
  }

  return {
    layout,
    signal,
    dispose() {
      lifetime.abort();
      cache.clear();
      for (const job of waiting.splice(0)) job.reject(signal.reason);
    },
  };
}

export function provideC4Layout() {
  const layout = createC4Layout();
  setContext(contextKey, layout);
  onDestroy(layout.dispose);
  return layout;
}

export const useC4Layout = () => getContext<ReturnType<typeof createC4Layout>>(contextKey);
