import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { activateArchiagent } from './archiagent-activation';
import { activationKey } from './archiagent-activation-state';
import { activationSnapshot } from './archiagent-activation-snapshot';
import { migrateCoordinatorProject } from './coordinator-migration';
import {
  dispatchState,
  requireCoordinationDispatch,
  setCoordinationDispatch,
} from './coordination-dispatch';
import { bindC4Protocol, projectC4Protocol, selectC4Protocol, taskC4Protocol } from './c4-protocol';

// SQLite authorization/protocol metadata only, no checkout, native worker, backend or fixture.
function context() {
  const db = AppDb.open(':memory:');
  const project = db.addProject({ name: 'Activation metadata', path: process.cwd() }).id;
  migrateCoordinatorProject(db, project);
  setCoordinationDispatch(db, project, false, 0);
  const expected = () => {
    const s = activationSnapshot(db, project, []);
    return {
      dispatchRevision: s.dispatch.revision,
      activationRevision: s.activation?.revision ?? 0,
      protocol: s.protocol,
      eligibility: s.eligibility,
    };
  };
  return { db, project, expected };
}

it('atomically opens the future-run protocol and replays once without changing old rights or bindings', () => {
  const { db, project, expected } = context();
  try {
    const legacy = db.createRun({
      projectId: project,
      taskId: 'legacy',
      agent: 'codex',
      logPath: 'README.md',
      adapterVersion: 'metadata',
    });
    const impact = db.createRun({
      projectId: project,
      taskId: 'impact',
      agent: 'codex',
      logPath: 'package.json',
      adapterVersion: 'metadata',
    });
    bindC4Protocol(db, project, impact.id, undefined, 'impact-v1');
    migrateCoordinatorProject(db, project);
    const rights = db.getSetting(`coordination.policy.${project}`, undefined);
    const resourcePolicy = { reserveDiskBytes: 1234567 };
    db.setSetting('resources.policy.v1', resourcePolicy);
    const stopped = db.getSetting(`execution.${impact.id}`, undefined);
    const input = expected();
    const first = activateArchiagent(db, project, 'impact-v1', input, 'owner-activation', []);
    expect(first.dispatch.enabled).toBe(true);
    expect(first.activation?.revision).toBe(1);
    expect(first.protocol).toBe('impact-v1');
    expect(taskC4Protocol(db, project, legacy.id)).toBe('package-v1');
    expect(taskC4Protocol(db, project, impact.id)).toBe('impact-v1');
    expect(db.getSetting(`execution.${impact.id}`, undefined)).toEqual(stopped);
    expect(db.getSetting(`coordination.policy.${project}`, undefined)).toEqual(rights);
    expect(db.getSetting('resources.policy.v1', undefined)).toEqual(resourcePolicy);
    expect(activateArchiagent(db, project, 'impact-v1', input, 'owner-activation', [])).toEqual(
      first,
    );
    expect(
      db.listEvents(project, 100).filter((e) => e.kind === 'archiagent_activated'),
    ).toHaveLength(1);
    expect(() => requireCoordinationDispatch(db, project)).not.toThrow();
    expect(() => selectC4Protocol(db, project, 'package-v1', 'impact-v1')).toThrow('atomic');
    expect(() =>
      activateArchiagent(db, project, 'package-v1', input, 'owner-activation', []),
    ).toThrow('identity changed');
  } finally {
    db.close();
  }
});

it('rejects stale readiness before changing any protocol, dispatch or activation receipt', () => {
  const { db, project, expected } = context();
  try {
    const input = expected();
    const policy = db.getSetting<Record<string, unknown>>(`coordination.policy.${project}`, {});
    db.setSetting(`coordination.policy.${project}`, { ...policy, revision: 1 });
    expect(() => activateArchiagent(db, project, 'impact-v1', input, 'stale-request', [])).toThrow(
      'inputs changed',
    );
    expect(projectC4Protocol(db, project)).toBe('package-v1');
    expect(dispatchState(db, project)).toEqual({ enabled: false, revision: 1 });
    expect(db.getSetting(activationKey(project), undefined)).toBeUndefined();
    expect(db.getSetting(`coordination.policy.${project}`, undefined)).toEqual({
      ...policy,
      revision: 1,
    });
  } finally {
    db.close();
  }
});

it('suspends without rearming old intent and requires a fresh owner request for compatible rollback', () => {
  const { db, project, expected } = context();
  try {
    const input = expected();
    const enabled = activateArchiagent(db, project, 'impact-v1', input, 'first', []);
    setCoordinationDispatch(db, project, false, enabled.dispatch.revision);
    expect(() => setCoordinationDispatch(db, project, true, enabled.dispatch.revision + 1)).toThrow(
      'atomic',
    );
    expect(() => activateArchiagent(db, project, 'impact-v1', input, 'first', [])).toThrow(
      'fresh owner request',
    );
    expect(dispatchState(db, project).enabled).toBe(false);
    const rollback = activateArchiagent(
      db,
      project,
      'package-v1',
      expected(),
      'explicit-compatible-rollback',
      [],
    );
    expect(rollback.activation?.revision).toBe(2);
    expect(rollback.protocol).toBe('package-v1');
    expect(rollback.dispatch.enabled).toBe(true);
  } finally {
    db.close();
  }
});

it('blocks unknown activation generations and legacy bypass while preserving the unknown record', () => {
  const { db, project, expected } = context();
  try {
    const input = expected();
    const unknown = { version: 2, evidence: 'Future authority must not be reinterpreted' };
    db.setSetting(activationKey(project), unknown);
    expect(() => requireCoordinationDispatch(db, project)).toThrow('suspended');
    expect(() => setCoordinationDispatch(db, project, true, 1)).toThrow('owner review');
    expect(() => activateArchiagent(db, project, 'impact-v1', input, 'unknown', [])).toThrow(
      'Unsupported',
    );
    expect(() => selectC4Protocol(db, project, 'impact-v1', 'package-v1')).toThrow('atomic');
    expect(setCoordinationDispatch(db, project, false, 1).enabled).toBe(false);
    expect(db.getSetting(activationKey(project), undefined)).toEqual(unknown);
    expect(projectC4Protocol(db, project)).toBe('package-v1');
  } finally {
    db.close();
  }
});
