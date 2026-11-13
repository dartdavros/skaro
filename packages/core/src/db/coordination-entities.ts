import { incidentIdentity } from '../coordination/incidents.ts';
import { isDeepStrictEqual } from 'node:util';
import type {
  CoordinationBlocker,
  CoordinationBlockerInput,
  CoordinationDecision,
  CoordinationDecisionInput,
  CoordinationEvidence,
} from '../coordination/model.ts';
import { coordinationBlocker, coordinationDecision } from '../coordination/entities.ts';
import {
  coordinationEvidence,
  metadataEnum,
  metadataId,
  metadataVersion,
} from '../coordination/validation.ts';
import {
  causalGet,
  coordinationAtomic,
  coordinatorGet,
  operationGet,
  type CoordinationDb,
} from './coordination-records.ts';

type Kinds = {
  decision: { input: CoordinationDecisionInput; record: CoordinationDecision };
  blocker: { input: CoordinationBlockerInput; record: CoordinationBlocker };
};
/** Durable questions/incidents are metadata, never an approval or an implicit task resume. */
export class DbCoordinationEntities<K extends keyof Kinds> {
  private readonly context: CoordinationDb;
  private readonly kind: K;
  constructor(context: CoordinationDb, kind: K) {
    this.context = context;
    this.kind = kind;
  }
  private validate(input: unknown): Kinds[K]['input'] {
    return (
      this.kind === 'decision' ? coordinationDecision(input) : coordinationBlocker(input)
    ) as Kinds[K]['input'];
  }
  get(projectId: string, id: string): Kinds[K]['record'] | undefined {
    metadataId(projectId);
    metadataId(id);
    if (!coordinatorGet(this.context.db, projectId)) return undefined;
    const row = this.context.db
      .prepare('SELECT * FROM coordination_entities WHERE project_id=? AND kind=? AND id=?')
      .get(projectId, this.kind, id);
    if (!row) return undefined;
    const value = this.validate(JSON.parse(String(row.value)));
    if (value.projectId !== projectId || value.id !== id)
      throw new Error('Stored coordination entity scope is inconsistent');
    const state = metadataEnum(
      row.state,
      this.kind === 'decision'
        ? ['pending', 'answered', 'denied', 'cancelled']
        : ['open', 'resolved', 'cancelled'],
    );
    const evidence =
      row.evidence === null ? undefined : coordinationEvidence(JSON.parse(String(row.evidence)));
    if (state !== 'pending' && state !== 'open' && !evidence)
      throw new Error('Stored coordination entity outcome has no evidence');
    return {
      ...value,
      state,
      ...(evidence ? { evidence } : {}),
      revision: metadataVersion(row.revision, 1),
      createdAt: metadataVersion(row.created_at),
      updatedAt: metadataVersion(row.updated_at),
    } as Kinds[K]['record'];
  }
  list(projectId: string): Kinds[K]['record'][] {
    metadataId(projectId);
    if (!coordinatorGet(this.context.db, projectId)) return [];
    return this.context.db
      .prepare(
        'SELECT id FROM coordination_entities WHERE project_id=? AND kind=? ORDER BY created_at,rowid',
      )
      .all(projectId, this.kind)
      .map((row) => this.get(projectId, String(row.id))!);
  }
  create(input: Kinds[K]['input']): Kinds[K]['record'] {
    const value = this.validate(input);
    return coordinationAtomic(this.context.db, () => {
      if (!causalGet(this.context.db, 'events', value.projectId, value.eventId))
        throw new Error('Coordination entity event is outside this project');
      if (
        'operationId' in value &&
        value.operationId &&
        !operationGet(this.context.db, value.projectId, value.operationId)
      )
        throw new Error('Coordination decision operation is outside this project');
      const at = this.context.now();
      this.context.db
        .prepare(
          `INSERT INTO coordination_entities(project_id,id,kind,value,revision,state,created_at,updated_at)
        VALUES (?,?,?,?,1,?,?,?) ON CONFLICT(project_id,kind,id) DO NOTHING`,
        )
        .run(
          value.projectId,
          value.id,
          this.kind,
          JSON.stringify(value),
          this.kind === 'decision' ? 'pending' : 'open',
          at,
          at,
        );
      const row = this.context.db
        .prepare('SELECT value FROM coordination_entities WHERE project_id=? AND kind=? AND id=?')
        .get(value.projectId, this.kind, value.id)!;
      if (!isDeepStrictEqual(JSON.parse(String(row.value)), value))
        throw new Error('Coordination entity identity already belongs to another request');
      return this.get(value.projectId, value.id)!;
    });
  }
  transition(
    projectId: string,
    id: string,
    input: {
      expectedRevision: number;
      state: Exclude<Kinds[K]['record']['state'], 'pending' | 'open'>;
      evidence: CoordinationEvidence;
    },
  ): Kinds[K]['record'] {
    metadataVersion(input.expectedRevision, 1);
    const state = metadataEnum(
      input.state,
      this.kind === 'decision' ? ['answered', 'denied', 'cancelled'] : ['resolved', 'cancelled'],
    );
    const evidence = coordinationEvidence(input.evidence);
    return coordinationAtomic(this.context.db, () => {
      const old = this.get(projectId, id);
      if (!old) throw new Error('Coordination entity is not registered in this project');
      if (old.state === state && isDeepStrictEqual(old.evidence, evidence)) return old;
      if (old.revision !== input.expectedRevision)
        throw new Error('Coordination entity revision changed');
      if (old.state !== 'pending' && old.state !== 'open')
        throw new Error('Coordination entity is already resolved');
      const changed = this.context.db
        .prepare(
          `UPDATE coordination_entities SET state=?,evidence=?,revision=revision+1,updated_at=?
        WHERE project_id=? AND kind=? AND id=? AND revision=?`,
        )
        .run(
          state,
          JSON.stringify(evidence),
          this.context.now(),
          projectId,
          this.kind,
          id,
          input.expectedRevision,
        );
      if (changed.changes !== 1) throw new Error('Coordination entity revision changed');
      return this.get(projectId, id)!;
    });
  }

  /** CAS update of a still-open incident; terminal evidence and identity cannot be rewritten. */
  reviseBlocker(input: CoordinationBlockerInput, expectedRevision: number): CoordinationBlocker {
    if (this.kind !== 'blocker') throw new Error('Only blockers support subscriber updates');
    const value = coordinationBlocker(input);
    return coordinationAtomic(this.context.db, () => {
      const old = this.get(value.projectId, value.id) as CoordinationBlocker | undefined;
      if (!old || old.state !== 'open' || old.revision !== expectedRevision)
        throw new Error('Incident changed or is terminal');
      if (
        old.eventId !== value.eventId ||
        old.inputHash !== value.inputHash ||
        !!old.protocol !== !!value.protocol ||
        (old.protocol &&
          value.protocol &&
          incidentIdentity(old.projectId, old.subject.id, old.protocol) !==
            incidentIdentity(value.projectId, value.subject.id, value.protocol)) ||
        !isDeepStrictEqual(old.subject, value.subject)
      )
        throw new Error('Incident identity cannot change');
      this.context.db
        .prepare(
          'UPDATE coordination_entities SET value=?, revision=revision+1, updated_at=? WHERE project_id=? AND kind=? AND id=? AND revision=?',
        )
        .run(
          JSON.stringify(value),
          this.context.now(),
          value.projectId,
          this.kind,
          value.id,
          expectedRevision,
        );
      return this.get(value.projectId, value.id) as CoordinationBlocker;
    });
  }
}
