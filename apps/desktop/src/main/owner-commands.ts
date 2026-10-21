import { randomUUID } from 'node:crypto';
import type { AppDb, OwnerCommand } from '@skaro/core';
import type { Handlers } from './ipc';
import type { MessageInput } from '../shared/ipc';
import { hasOwnerCommand } from './owner-command-history';

type SendMethod = 'chat.send' | 'task.send';
export class CommandCancelled extends Error {
  constructor() {
    super('Owner cancelled the command.');
  }
}
let current: OwnerCommands | undefined;
const blockedOwners = new Map<string, string>();
/** Clearing a conversation must not race with accepting a new message for that owner. */
export function blockOwnerMessages(
  project: string,
  owner: string,
  reason = 'Chat history is being cleared. Retry after it finishes.',
): () => void {
  const key = `${project}:${owner}`;
  if (blockedOwners.has(key)) throw new Error('Chat history is being cleared.');
  blockedOwners.set(key, reason);
  return () => {
    blockedOwners.delete(key);
  };
}
export function queueOwnerMessage(
  method: SendMethod,
  project: string,
  owner: string,
  input: MessageInput,
): void {
  if (!current) throw new Error('The command inbox is not ready.');
  current.accept(method, project, owner, input);
}
export function cancelOwnerMessages(project: string, owner: string): void {
  current?.cancel(`${project}:${owner}`);
}
/** Acceptance is synchronous and durable; agent attachment runs after the IPC acknowledgement. */
export class OwnerCommands {
  private readonly db: AppDb;
  private readonly publish: (command: OwnerCommand) => void;
  private readonly queues = new Map<string, Promise<void>>();
  private handlers?: Handlers;
  private readonly scheduled = new Set<string>();
  constructor(db: AppDb, publish: (command: OwnerCommand) => void) {
    this.db = db;
    this.publish = publish;
  }
  accept(method: SendMethod, projectId: string, ownerId: string, input: MessageInput): void {
    const blocked = blockedOwners.get(`${projectId}:${ownerId}`);
    if (blocked) throw new Error(blocked);
    const id = input.commandId ?? randomUUID();
    const command = this.db.commands.accept({
      id,
      method,
      owner: `${projectId}:${ownerId}`,
      args: [projectId, ownerId, { ...input, commandId: id }],
      state: 'accepted',
    });
    this.publish(command);
    if (command.state === 'accepted') this.schedule(command);
    else if (command.state === 'failed' || command.state === 'uncertain')
      throw new Error(command.error);
  }
  start(handlers: Handlers): void {
    this.handlers = handlers;
    // The module routes durable answers through the one application inbox.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    current = this;
    for (const command of this.db.commands.pending()) {
      if (command.state === 'delivering') {
        void this.reconcile(command);
      } else this.schedule(command);
    }
  }
  private async reconcile(command: OwnerCommand): Promise<void> {
    try {
      const [project, owner] = command.args as [string, string];
      const state =
        command.method === 'chat.send'
          ? (await this.handlers!['chat.open'](project, owner)).timeline
          : (await this.handlers!['task.open'](project, owner)).timeline;
      if (hasOwnerCommand(state, command.id)) {
        this.publish(this.db.commands.update(command.id, 'delivered'));
        return;
      }
    } catch (error) {
      console.error('Command recovery:', error);
    }
    this.publish(
      this.db.commands.update(
        command.id,
        'uncertain',
        'Delivery was interrupted before native acknowledgement. Check the saved conversation before resending.',
      ),
    );
  }
  private schedule(command: OwnerCommand): void {
    if (
      !this.handlers ||
      this.scheduled.has(command.id) ||
      this.db.commands.get(command.id)?.state !== 'accepted'
    )
      return;
    // A duplicate click may arrive before the microtask begins.
    this.scheduled.add(command.id);
    const previous = this.queues.get(command.owner) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        if (this.db.commands.get(command.id)?.state !== 'accepted') {
          this.scheduled.delete(command.id);
          return;
        }
        const handler = this.handlers![command.method as SendMethod] as (
          ...args: unknown[]
        ) => Promise<void>;
        try {
          this.db.commands.update(command.id, 'delivering');
          await handler(...command.args);
          if (this.db.commands.get(command.id)?.state !== 'cancelled')
            this.publish(this.db.commands.update(command.id, 'delivered'));
        } catch (error) {
          if (this.db.commands.get(command.id)?.state !== 'cancelled')
            this.publish(
              this.db.commands.update(
                command.id,
                'failed',
                error instanceof Error ? error.message : String(error),
              ),
            );
        } finally {
          this.scheduled.delete(command.id);
        }
      });
    this.queues.set(command.owner, operation);
    void operation.finally(() => {
      if (this.queues.get(command.owner) === operation) this.queues.delete(command.owner);
    });
  }
  async close(): Promise<void> {
    await Promise.all(this.queues.values());
  }
  cancel(owner: string): void {
    for (const command of this.db.commands.cancel(owner)) this.publish(command);
  }
}
