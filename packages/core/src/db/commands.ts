import { DbTable } from './table.ts';

import type { OwnerCommand } from '@skaro/timeline';
export type { OwnerCommand } from '@skaro/timeline';

/** One durable command identity, independent from process startup and native turn duration. */
export class DbCommands extends DbTable {
  get(id: string): OwnerCommand | undefined {
    const row = this.db.prepare('SELECT * FROM owner_commands WHERE id=?').get(id);
    return row
      ? {
          id,
          owner: String(row['owner']),
          method: String(row['method']),
          args: JSON.parse(String(row['args'])) as unknown[],
          state: row['state'] as OwnerCommand['state'],
          ...(row['error'] ? { error: String(row['error']) } : {}),
        }
      : undefined;
  }
  accept(command: OwnerCommand): OwnerCommand {
    const previous = this.get(command.id);
    if (previous) {
      if (
        previous.owner !== command.owner ||
        previous.method !== command.method ||
        JSON.stringify(previous.args) !== JSON.stringify(command.args)
      )
        throw new Error('This command identity already belongs to another request.');
      return previous;
    }
    this.db
      .prepare(
        'INSERT INTO owner_commands (id,owner,method,args,state,updated_at) VALUES (?,?,?,?,?,?)',
      )
      .run(
        command.id,
        command.owner,
        command.method,
        JSON.stringify(command.args),
        'accepted',
        this.now(),
      );
    return command;
  }
  update(id: string, state: OwnerCommand['state'], error?: string): OwnerCommand {
    this.db
      .prepare('UPDATE owner_commands SET state=?,error=?,updated_at=? WHERE id=?')
      .run(state, error ?? null, this.now(), id);
    return this.get(id)!;
  }
  pending(): OwnerCommand[] {
    return this.db
      .prepare(
        "SELECT id FROM owner_commands WHERE state IN ('accepted','delivering') ORDER BY updated_at",
      )
      .all()
      .map((r) => this.get(String(r['id']))!);
  }
  forOwner(owner: string): OwnerCommand[] {
    return this.db
      .prepare(
        "SELECT id FROM owner_commands WHERE owner=? AND state IN ('accepted','delivering','uncertain','failed') ORDER BY updated_at DESC LIMIT 100",
      )
      .all(owner)
      .map((row) => this.get(String(row['id']))!);
  }
  hasOutstanding(owner: string): boolean {
    return !!this.db
      .prepare(
        "SELECT 1 FROM owner_commands WHERE owner=? AND state IN ('accepted','delivering','uncertain','failed') LIMIT 1",
      )
      .get(owner);
  }
  cancel(owner: string): OwnerCommand[] {
    const ids = this.db
      .prepare("SELECT id FROM owner_commands WHERE owner=? AND state IN ('accepted','delivering')")
      .all(owner);
    return ids.map((row) => this.update(String(row['id']), 'cancelled'));
  }
  /** Active delivery only; failures and uncertain receipts need attention instead of a spinner. */
  hasPendingInput(owner: string): boolean {
    return !!this.db
      .prepare(
        "SELECT 1 FROM owner_commands WHERE owner=? AND method IN ('task.send','chat.send') AND state IN ('accepted','delivering') LIMIT 1",
      )
      .get(owner);
  }
}
