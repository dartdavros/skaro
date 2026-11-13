import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { AppDb } from './appdb.ts';
import {
  incidentHash,
  incidentIdentity,
  type IncidentProtocol,
} from '../coordination/incidents.ts';

it('persists incident subscriber revisions with CAS and refuses identity edits or terminal rewrites', async () => {
  // Real repository observation in an actual SQLite ledger; no project or backend is seeded.
  const db = AppDb.open(':memory:');
  const projectId = process.cwd(),
    file = resolve('package.json');
  const version = incidentHash(await readFile(file, 'utf8'));
  const subject = { kind: 'document' as const, id: file, version };
  try {
    db.coordination.ensure(projectId);
    const event = {
      id: 'observed',
      projectId,
      kind: 'filesystem.observed',
      source: { kind: 'controller' as const, id: file },
      subject,
      inputHash: version,
    };
    db.coordination.accept({
      event,
      intent: {
        id: 'observe',
        projectId,
        eventId: event.id,
        action: 'filesystem.observe',
        source: event.source,
        subject,
        inputHash: version,
      },
      operation: {
        id: 'observe',
        projectId,
        eventId: event.id,
        intentId: 'observe',
        idempotencyKey: 'observe',
        action: 'filesystem.observe',
        subject,
        scopeKey: file,
        mode: 'observation',
        inputHash: version,
      },
    });
    const protocol: IncidentProtocol = {
      cause: 'dependency',
      code: 'input_observed',
      resourceVersion: version,
      condition: 'inputs-current',
      phase: 'diagnosing',
      attempts: 0,
      subscriptions: [],
    };
    const input = {
      id: 'input',
      projectId,
      eventId: event.id,
      subject,
      category: 'dependency' as const,
      inputHash: incidentIdentity(projectId, file, protocol),
      subscribers: [],
      resolution: { code: 'inputs-current', refs: [subject], fingerprint: version },
      protocol,
    };
    const created = db.coordination.blockers.create(input);
    const revised = db.coordination.blockers.reviseBlocker(
      { ...input, protocol: { ...protocol, phase: 'waiting' } },
      created.revision,
    );
    expect(revised.protocol?.phase).toBe('waiting');
    expect(() =>
      db.coordination.blockers.reviseBlocker(
        {
          ...input,
          protocol: { ...protocol, resourceVersion: incidentHash('another-resource-version') },
        },
        revised.revision,
      ),
    ).toThrow('identity');
    expect(() =>
      db.coordination.blockers.reviseBlocker(
        { ...input, protocol: { ...protocol, ownerPolicyRevision: 1 } },
        revised.revision,
      ),
    ).toThrow('identity');
    expect(incidentIdentity(projectId, file, { ...protocol, ownerPolicyRevision: 1 })).not.toBe(
      incidentIdentity(projectId, file, { ...protocol, ownerPolicyRevision: 2 }),
    );
    expect(() => db.coordination.blockers.reviseBlocker(input, created.revision)).toThrow();
    expect(() =>
      db.coordination.blockers.reviseBlocker(
        { ...input, inputHash: incidentHash('changed') },
        revised.revision,
      ),
    ).toThrow();
    const resolved = db.coordination.blockers.transition(projectId, input.id, {
      expectedRevision: revised.revision,
      state: 'resolved',
      evidence: { code: 'filesystem_observed', refs: [subject], fingerprint: version },
    });
    expect(() => db.coordination.blockers.reviseBlocker(input, resolved.revision)).toThrow();
  } finally {
    db.close();
  }
});
