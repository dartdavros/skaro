import { type Item, type TimelineState, type OwnerCommand } from '@skaro/timeline';
import type { MessageInput } from '../../../shared/ipc';
import { pendingOwnerCommand } from './owner-command-state';
import { matchesOwnerMessage, visibleOwnerMessages } from './owner-message-history';
import type { HistoryPage, HistorySource } from '../../../shared/history';

type Pending = { input: MessageInput; at: number; error?: string; delivered?: boolean };
/** Immediate owner echo, reconciled with the native message instead of showing duplicates. */
export class OwnerMessages {
  pending = $state.raw<Pending[]>([]);
  restore(commands: OwnerCommand[]): void {
    const pending = commands
      .filter(pendingOwnerCommand)
      .filter((command) => !this.pending.some((p) => p.input.commandId === command.id))
      .map((command) => ({
        input: command.args[2] as MessageInput,
        at: Date.now(),
        error: command.error,
      }));
    if (pending.length) this.pending = [...pending.reverse(), ...this.pending];
  }
  add(input: MessageInput): MessageInput {
    const value = { ...input, commandId: input.commandId ?? crypto.randomUUID() };
    this.pending = [...this.pending, { input: value, at: Date.now() }];
    return value;
  }
  async send<T>(input: MessageInput, deliver: (value: MessageInput) => Promise<T>): Promise<T> {
    const value = this.add(input);
    try {
      return await deliver(value);
    } catch (error) {
      this.failed(value.commandId!, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  cancel(id: string): void {
    this.pending = this.pending.filter((pending) => pending.input.commandId !== id);
  }
  delivered(id: string): void {
    this.pending = this.pending.map((p) =>
      p.input.commandId === id ? { ...p, delivered: true } : p,
    );
  }
  cancelThrough(at: number): void {
    this.pending = this.pending.filter((pending) => pending.at > at);
  }
  failed(id: string, error: string): void {
    this.pending = this.pending.map((p) => (p.input.commandId === id ? { ...p, error } : p));
  }
  reconcile(
    timeline: TimelineState | undefined,
    view?: { history?: HistorySource; historyPage?: HistoryPage },
  ): void {
    const items = visibleOwnerMessages(timeline, view);
    const remaining = this.pending.filter(
      (pending) => !items.some((item) => matchesOwnerMessage(item, pending.input, pending.at)),
    );
    if (remaining.length !== this.pending.length) this.pending = remaining;
  }
  timeline(base: TimelineState | undefined, history?: HistorySource): TimelineState | undefined {
    if (!this.pending.length) return base;
    const items: (Item & { localEcho: boolean })[] = this.pending.map((p) => ({
      id: `owner-${p.input.commandId}`,
      localEcho: !!history || !base?.items.some((item) => item.id === `owner-${p.input.commandId}`),
      turnId: '',
      kind: 'message',
      role: 'user',
      text: p.input.text,
      status: 'done',
      startedAt: p.at,
      native: { agent: 'skaro', type: 'owner_command', ref: p.input.commandId! },
    }));
    return {
      ...(base ?? { turns: [], interactions: [], status: 'idle' }),
      ...(!base?.interactions.some((i) => i.kind === 'question') &&
      this.pending.some((p) => !p.error && !p.delivered)
        ? { status: 'working' as const, activity: { state: 'waiting_model' } }
        : {}),
      items: [
        ...(base?.items ?? []).filter((item) => !items.some((pending) => pending.id === item.id)),
        ...items,
      ],
    };
  }
}
