import type { OwnerCommand } from '@skaro/timeline';

/** Only unresolved delivery has an optimistic row. A failed attempt is not a sent message. */
export function pendingOwnerCommand(command: Pick<OwnerCommand, 'state'>): boolean {
  return ['accepted', 'delivering', 'uncertain'].includes(command.state);
}

export function restoredCommandError(commands: readonly OwnerCommand[]): string | undefined {
  // Unknown delivery still needs attention; completed failures remain in the durable inbox.
  return commands.find((command) => command.state === 'uncertain')?.error;
}
