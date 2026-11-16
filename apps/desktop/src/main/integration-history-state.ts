import type { Item } from '@skaro/timeline';

export function inBackground(item: Item): boolean {
  return item.kind === 'command' && item.background?.state === 'running';
}

/** An item of a resolver that no longer runs. */
export function abandoned(item: Item): Item {
  if (item.kind !== 'command' || item.background?.state !== 'running')
    return { ...item, status: 'interrupted' };
  return {
    ...item,
    status: 'interrupted',
    endedAt: Date.now(),
    background: { ...item.background, state: 'stopped' },
  };
}
