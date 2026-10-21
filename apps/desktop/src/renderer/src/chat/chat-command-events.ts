import type { OwnerMessages } from '../feed/owner-messages.svelte';

/** Durable input delivery belongs to the command inbox, independently of history rendering. */
export function watchChatCommands(
  projectId: string,
  chatId: string | undefined,
  messages: OwnerMessages,
  onerror: (error: string | undefined) => void,
): () => void {
  let disposed = false;
  if (chatId)
    void window.skaro
      .invoke('commands.list', projectId, chatId)
      .then((commands) => {
        if (disposed) return;
        messages.restore(commands);
        onerror(commands.find((command) => command.error)?.error);
      })
      .catch((error) => {
        if (!disposed) onerror(String(error));
      });
  const unsubscribe = window.skaro.on('command.changed', (command) => {
    if (command.owner !== `${projectId}:${chatId}`) return;
    if (command.state === 'accepted' || command.state === 'delivering') messages.restore([command]);
    if (command.state === 'cancelled') messages.cancel(command.id);
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
