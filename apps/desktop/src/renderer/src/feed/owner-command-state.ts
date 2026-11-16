import type { OwnerCommand } from '@skaro/timeline';

/** Restore unresolved delivery only; completed commands already belong to history. */
export function pendingOwnerCommand(
  command: Pick<OwnerCommand, 'state'> & Partial<Pick<OwnerCommand, 'args'>>,
): boolean {
  return (
    visibleOwnerCommand(command) && ['accepted', 'delivering', 'uncertain'].includes(command.state)
  );
}

/** Controller assignments are durable inputs, never owner-authored chat bubbles. */
export function visibleOwnerCommand(command: Partial<Pick<OwnerCommand, 'args'>>): boolean {
  const input = command.args?.[2];
  return !(input && typeof input === 'object' && 'internal' in input && input.internal === true);
}

/** Delivery alone does not prove that the replacement history row has loaded. */
export function retiredOwnerCommand(command: Pick<OwnerCommand, 'state'>): boolean {
  return command.state === 'failed' || command.state === 'cancelled';
}

export function restoredCommandError(commands: readonly OwnerCommand[]): string | undefined {
  // Unknown delivery still needs attention; completed failures remain in the durable inbox.
  return commands.find((command) => visibleOwnerCommand(command) && command.state === 'uncertain')
    ?.error;
}
