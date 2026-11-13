import type { DatabaseSync } from 'node:sqlite';
import { DbResourceCleanup } from './resource-cleanup.ts';
import { isDeepStrictEqual } from 'node:util';
import type {
  ResourceOutcome,
  ResourceOutcomeInput,
  ResourcePatch,
  ResourceRecord,
  ResourceRegistration,
} from '../resources/model.ts';
import {
  resourceId,
  resourceOutcome,
  resourcePatch,
  resourceRegistration,
} from '../resources/validation.ts';
import { DbTable } from './table.ts';
import { resourceLeaseConsumers } from './admission-consumers.ts';

const fields = `resources.*, (SELECT value FROM resource_outcomes
  WHERE resource_id=resources.id ORDER BY at DESC,rowid DESC LIMIT 1) AS last_outcome`;
type Row = { [key: string]: unknown };
function record(row: Row): ResourceRecord {
  const value = resourceRegistration(JSON.parse(String(row.value)));
  if (
    resourceId(value) !== row.id ||
    value.projectId !== row.project_id ||
    value.generation !== row.generation ||
    !Number.isSafeInteger(row.revision) ||
    Number(row.revision) < 1
  )
    throw new Error('Stored resource identity is inconsistent');
  return {
    ...value,
    id: String(row.id),
    revision: Number(row.revision),
    generation: Number(row.generation),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ...(row.last_outcome
      ? { lastOutcome: JSON.parse(String(row.last_outcome)) as ResourceOutcome }
      : {}),
  };
}
function registration(value: ResourceRecord): ResourceRegistration {
  const {
    id: _id,
    revision: _revision,
    createdAt: _created,
    updatedAt: _updated,
    lastOutcome: _outcome,
    ...input
  } = value;
  return input;
}

/** A durable ownership ledger, not an authorization to stop or delete the recorded objects. */
export class DbResources extends DbTable {
  readonly cleanup: DbResourceCleanup;
  constructor(db: DatabaseSync, now: () => number) {
    super(db, now);
    this.cleanup = new DbResourceCleanup(db, (id) => this.get(id));
  }
  private exists(): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='resources'")
      .get();
  }

  /** Read-only callers can inspect an older database without triggering migration. */
  get(id: string): ResourceRecord | undefined {
    if (!this.exists()) return undefined;
    const row = this.db.prepare(`SELECT ${fields} FROM resources WHERE id=?`).get(id);
    return row ? record(row) : undefined;
  }

  list(projectId?: string): ResourceRecord[] {
    if (!this.exists()) return [];
    const statement = this.db.prepare(
      `SELECT ${fields} FROM resources ${projectId === undefined ? '' : 'WHERE project_id=?'} ORDER BY id`,
    );
    return (projectId === undefined ? statement.all() : statement.all(projectId)).map(record);
  }

  register(input: ResourceRegistration): ResourceRecord {
    return this.cleanup.atomic(() => this.registerChecked(input));
  }

  private registerChecked(input: ResourceRegistration): ResourceRecord {
    const value = resourceRegistration(input);
    const id = resourceId(value);
    this.cleanup.assertRegistration(id, value);
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO resources(id,project_id,revision,generation,value,created_at,updated_at)
      VALUES (?,?,1,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
      )
      .run(id, value.projectId, value.generation, JSON.stringify(value), now, now);
    const saved = this.get(id)!;
    if (!isDeepStrictEqual(registration(saved), value))
      throw new Error(
        'Resource identity already has different registration; retain it for reconciliation',
      );
    return saved;
  }

  update(id: string, expectedRevision: number, input: ResourcePatch): ResourceRecord {
    return this.cleanup.atomic(() => this.updateChecked(id, expectedRevision, input));
  }

  private updateChecked(
    id: string,
    expectedRevision: number,
    input: ResourcePatch,
  ): ResourceRecord {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      throw new Error('Invalid expected resource revision');
    const patch = resourcePatch(input);
    const previous = this.get(id);
    if (!previous || previous.revision !== expectedRevision)
      throw new Error('Resource revision changed');
    const value = resourceRegistration({ ...registration(previous), ...patch });
    this.cleanup.assertMutation(previous, value);
    const leases = resourceLeaseConsumers(this.db, id);
    if (
      leases
        .filter((lease) => !this.cleanup.ownsLeaseConsumer(lease.id))
        .some(
          (lease) =>
            value.generation !== lease.generation ||
            value.state === 'released' ||
            !value.consumers.some(
              (consumer) => consumer.id === lease.id && consumer.generation === lease.generation,
            ),
        )
    )
      throw new Error('Active resource leases must retain their generation and consumers');
    if (
      value.generation !== previous.generation &&
      (value.generation !== previous.generation + 1 || previous.state !== 'released')
    )
      throw new Error('Resource generation can advance only after release');
    if (isDeepStrictEqual(registration(previous), value)) return previous;
    const result = this.db
      .prepare(
        `UPDATE resources SET value=?,generation=?,revision=revision+1,updated_at=?
      WHERE id=? AND revision=?`,
      )
      .run(JSON.stringify(value), value.generation, this.now(), id, expectedRevision);
    if (result.changes !== 1) throw new Error('Resource revision changed');
    return this.get(id)!;
  }

  /** One immutable final outcome per operation; a retry is a new operation identity. */
  recordOutcome(input: ResourceOutcomeInput): ResourceOutcome {
    const value = resourceOutcome(input);
    let result: ResourceOutcome | undefined;
    this.transaction(() => {
      const old = this.db
        .prepare('SELECT value FROM resource_outcomes WHERE operation_id=?')
        .get(value.operationId);
      if (old) {
        const saved = JSON.parse(String(old.value)) as ResourceOutcome;
        const { at: _at, ...previous } = saved;
        if (!isDeepStrictEqual(previous, value))
          throw new Error('Resource operation identity already belongs to a different outcome');
        result = saved;
        return;
      }
      const resource = this.get(value.resourceId);
      if (!resource || resource.generation !== value.generation)
        throw new Error('Resource outcome belongs to an obsolete generation');
      result = { ...value, at: this.now() };
      this.db
        .prepare(
          `INSERT INTO resource_outcomes(operation_id,resource_id,generation,value,at)
        VALUES (?,?,?,?,?)`,
        )
        .run(
          value.operationId,
          value.resourceId,
          value.generation,
          JSON.stringify(result),
          result.at,
        );
    });
    return result!;
  }

  outcomes(resourceId: string, limit = 50): ResourceOutcome[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('Invalid resource outcome page limit');
    if (!this.exists()) return [];
    return this.db
      .prepare(
        'SELECT value FROM resource_outcomes WHERE resource_id=? ORDER BY at DESC,rowid DESC LIMIT ?',
      )
      .all(resourceId, limit)
      .map((row) => JSON.parse(String(row.value)) as ResourceOutcome);
  }
}
