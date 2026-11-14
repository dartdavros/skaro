import type { OwnerCommand } from '@skaro/timeline';

/** Restore unresolved delivery only; completed commands already belong to history. */
export function pendingOwnerCommand(command: Pick<OwnerCommand, 'state'>): boolean {
  return ['accepted', 'delivering', 'uncertain'].includes(command.state);
}

/** Delivery alone does not prove that the replacement history row has loaded. */
export function retiredOwnerCommand(command: Pick<OwnerCommand, 'state'>): boolean {
  return command.state === 'failed' || command.state === 'cancelled';
}

export function restoredCommandError(commands: readonly OwnerCommand[]): string | undefined {
  // Unknown delivery still needs attention; completed failures remain in the durable inbox.
  return commands.find((command) => command.state === 'uncertain')?.error;
}
