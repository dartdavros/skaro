import { randomUUID } from 'node:crypto';
import type { AppDb, CoordinationRef, OwnerCommand } from '@skaro/core';
import type { Handlers } from './ipc';
import type { MessageInput } from '../shared/ipc';
import type { ProjectCoordinators } from './project-coordinators';
import { OwnerCommandCoordination } from './owner-command-coordination';
import { CoordinationPending } from './project-coordinator-errors';
import { registerOwnerOrigin } from './owner-command-provenance';

type SendMethod = 'chat.send' | 'task.send';
type DeliveryHandlers = Pick<Handlers, SendMethod>;
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
export function cancelOwnerMessages(project: string, owner: string): string[] {
  return current?.cancel(`${project}:${owner}`) ?? [];
}
/** Capture unresolved deliveries for an explicit Stop; uncertainty stays intact until verified teardown. */
export function stopOwnerMessages(project: string, owner: string): string[] {
  return current?.captureStop(project, owner) ?? [];
}
/** Called only after the existing native stop protocol confirms teardown. */
export async function confirmOwnerMessagesStopped(
  project: string,
  owner: string,
  commandIds: readonly string[],
  proof: CoordinationRef,
): Promise<void> {
  await current?.confirmStopped(project, owner, commandIds, proof);
}
/** Acceptance is synchronous and durable; agent attachment runs after the IPC acknowledgement. */
export class OwnerCommands {
  private readonly db: AppDb;
  private readonly publish: (command: OwnerCommand) => void;
  private readonly queues = new Map<string, Promise<void>>();
  private readonly deliveries = new Map<string, Promise<void>>();
  private handlers?: DeliveryHandlers;
  private readonly coordination?: OwnerCommandCoordination;
  private readonly recoveries = new Set<Promise<boolean>>();
  private readonly scheduled = new Set<string>();
  private closing = false;
  private dispatchReady = false;
  constructor(
    db: AppDb,
    publish: (command: OwnerCommand) => void,
    coordinators?: ProjectCoordinators,
    dataDir?: string,
  ) {
    this.db = db;
    this.publish = publish;
    if (coordinators && dataDir)
      this.coordination = new OwnerCommandCoordination(db, coordinators, dataDir);
  }
  accept(method: SendMethod, projectId: string, ownerId: string, input: MessageInput): void {
    if (this.closing) throw new Error('The command inbox is closing.');
    const blocked = blockedOwners.get(`${projectId}:${ownerId}`);
    if (blocked) throw new Error(blocked);
    this.requireCoordination().validate(projectId);
    const id = input.commandId ?? randomUUID();
    const request: OwnerCommand = {
      id,
      method,
      owner: `${projectId}:${ownerId}`,
      args: [projectId, ownerId, { ...input, commandId: id }],
      state: 'accepted',
    };
    registerOwnerOrigin(this.db, request);
    const command = this.db.commands.accept(request);
    this.publish(command);
    if (command.state === 'accepted') this.schedule(command);
    else if (command.state === 'failed' || command.state === 'uncertain')
      throw new Error(command.error);
  }
  start(handlers: DeliveryHandlers, deferDispatch = false): void {
    if (this.closing) throw new Error('The command inbox is closing.');
    this.requireCoordination();
    this.handlers = handlers;
    // The module routes durable answers through the one application inbox.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    current = this;
    if (!deferDispatch) this.activate();
  }
  /** Recovery may cancel old inputs while the inbox is present but no native writer can start. */
  activate(): void {
    if (this.closing || this.dispatchReady) return;
    this.dispatchReady = true;
    const commands = new Map(
      [...this.db.commands.pending(), ...this.requireCoordination().unresolved()].map((command) => [
        command.id,
        command,
      ]),
    );
    for (const command of commands.values()) {
      if (this.db.shell.projectScope && command.args[0] !== this.db.shell.projectScope) continue;
      if (command.state === 'delivering' || this.requireCoordination().uncertain(command)) {
        const recovery = this.reconcile(command);
        this.recoveries.add(recovery);
        void recovery.finally(() => this.recoveries.delete(recovery)).catch(() => undefined);
      } else this.schedule(command);
    }
  }
  private async reconcile(command: OwnerCommand): Promise<boolean> {
    try {
      if (await this.requireCoordination().reconcile(command)) {
        if (this.db.commands.get(command.id)?.state !== 'cancelled')
          this.publish(this.db.commands.update(command.id, 'delivered'));
        return true;
      }
    } catch (error) {
      console.error('Command recovery:', error);
    }
    if (['cancelled', 'delivered'].includes(this.db.commands.get(command.id)?.state ?? ''))
      return false;
    this.publish(
      this.db.commands.update(
        command.id,
        'uncertain',
        'Delivery was interrupted before native acknowledgement. Check the saved conversation before resending.',
      ),
    );
    return false;
  }
  private schedule(command: OwnerCommand): void {
    if (
      !this.handlers ||
      !this.dispatchReady ||
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
          for (const prior of this.requireCoordination().prior(command))
            await this.reconcile(prior);
          await this.requireCoordination().deliver(command, async () => {
            if (this.db.commands.get(command.id)?.state !== 'accepted') return;
            this.db.commands.update(command.id, 'delivering');
            await handler(...command.args);
            if (this.db.commands.get(command.id)?.state !== 'cancelled')
              this.publish(this.db.commands.update(command.id, 'delivered'));
          });
        } catch (error) {
          // Shutdown fenced an effect before dispatch; its durable inbox arguments remain valid.
          if (
            error instanceof CoordinationPending &&
            error.operation.state === 'queued' &&
            this.requireCoordination().stopping()
          )
            return;
          const state = this.db.commands.get(command.id)?.state;
          if (state !== 'cancelled' && this.requireCoordination().uncertain(command)) {
            await this.reconcile(command);
            return;
          }
          if (state !== 'cancelled' && state !== 'delivered')
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
    this.deliveries.set(command.id, operation);
    void operation
      .finally(() => {
        if (this.queues.get(command.owner) === operation) this.queues.delete(command.owner);
        if (this.deliveries.get(command.id) === operation) this.deliveries.delete(command.id);
      })
      .catch((error: unknown) => console.error('Command delivery:', error));
  }
  async close(): Promise<void> {
    this.closing = true;
    if (current === this) current = undefined;
    await Promise.allSettled([...this.queues.values(), ...this.recoveries]);
  }
  cancel(owner: string): string[] {
    const cancelled = this.db.commands.cancel(owner);
    for (const command of cancelled) this.publish(command);
    return cancelled.map((command) => command.id);
  }
  captureStop(project: string, owner: string): string[] {
    const scope = `${project}:${owner}`;
    const ids = this.cancel(scope);
    for (const operation of this.db.coordination.pending(project)) {
      if (!operation.id.startsWith('owner-command:')) continue;
      const id = operation.id.slice('owner-command:'.length),
        command = this.db.commands.get(id);
      if (command?.owner === scope && !['delivered'].includes(command.state)) ids.push(id);
    }
    return [...new Set(ids)];
  }
  async confirmStopped(
    project: string,
    owner: string,
    ids: readonly string[],
    proof: CoordinationRef,
  ) {
    // Native teardown precedes this boundary. Let each captured executor finish recording its
    // interrupted outcome; never overwrite a still-dispatching claim or wait for later messages.
    await Promise.allSettled(ids.flatMap((id) => this.deliveries.get(id) ?? []));
    for (const id of ids) {
      const command = this.db.commands.get(id);
      if (
        command?.owner === `${project}:${owner}` &&
        ['cancelled', 'uncertain', 'failed'].includes(command.state)
      ) {
        this.requireCoordination().stopped(command, proof);
        if (command.state !== 'cancelled') this.publish(this.db.commands.update(id, 'cancelled'));
      }
    }
  }
  private requireCoordination(): OwnerCommandCoordination {
    if (!this.coordination) throw new Error('The project coordinator is not ready.');
    return this.coordination;
  }
}
