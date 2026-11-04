import type { OwnerMessages } from './owner-messages.svelte';
import { pendingOwnerCommand, restoredCommandError } from './owner-command-state';

/** Durable delivery state is separate from a screen's transient action error. */
export function watchOwnerCommands(
  projectId: string,
  ownerId: string | undefined,
  messages: OwnerMessages,
  onerror: (error: string | undefined) => void,
): () => void {
  let disposed = false;
  const changed = new Set<string>();
  if (ownerId)
    void window.skaro
      .invoke('commands.list', projectId, ownerId)
      .then((commands) => {
        if (disposed) return;
        // A live acknowledgement may arrive while the initial snapshot is in flight.
        const fresh = commands.filter((command) => !changed.has(command.id));
        messages.restore(fresh);
        const unresolved = restoredCommandError(fresh);
        if (unresolved) onerror(unresolved);
      })
      .catch((error) => {
        if (!disposed) onerror(String(error));
      });
  const unsubscribe = window.skaro.on('command.changed', (command) => {
    if (command.owner !== `${projectId}:${ownerId}`) return;
    changed.add(command.id);
    if (pendingOwnerCommand(command)) messages.restore([command]);
    else messages.cancel(command.id);
    if (command.error) {
      messages.failed(command.id, command.error);
      onerror(command.error);
    }
  });
  return () => {
    disposed = true;
    unsubscribe();
  };
}
