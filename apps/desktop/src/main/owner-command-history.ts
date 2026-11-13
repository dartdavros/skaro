import type { Item, TimelineState } from '@skaro/timeline';

export function isOwnerCommandMessage(item: Item, id: string): boolean {
  return (
    item.kind === 'message' &&
    item.role === 'user' &&
    item.native.type !== 'owner_command' &&
    item.text.includes(`command_id: ${id}\n`)
  );
}

/** Only a native user-message echo proves acceptance; the optimistic Skaro row does not. */
export function hasOwnerCommand(state: TimelineState | undefined, id: string | undefined): boolean {
  return !!id && !!state?.items.some((item) => isOwnerCommandMessage(item, id));
}
