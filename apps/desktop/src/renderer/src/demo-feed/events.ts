// Demo feed events: an item gets the demo clock, the turn and a native reference.

import type { Item, TimelineEvent } from '@skaro/timeline';

type Draft = Item extends infer I
  ? I extends Item
    ? Omit<I, 'turnId' | 'startedAt' | 'native'>
    : never
  : never;

const T0 = Date.now() - 5 * 60_000;
let clock = T0;

export const W = 'C:/work/shop-api';

export function resetClock(): void {
  clock = T0;
}

export const now = (): number => clock;

export function item(draft: Draft, turnId = 't1', secs = 3): TimelineEvent {
  clock += secs * 1000;
  return {
    t: 'item.upsert',
    item: {
      ...draft,
      turnId,
      startedAt: clock,
      ...(draft.status === 'done' ? { endedAt: clock + 2000 } : {}),
      native: { agent: 'demo', type: draft.kind, ref: draft.id },
    } as Item,
  };
}
