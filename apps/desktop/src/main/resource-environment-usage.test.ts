import { expect, it } from 'vitest';
import { AppDb, type ResourceCost } from '@skaro/core';
import { observedEnvironmentUsage } from './resource-environment-usage';

it('credits only registered exact container identities once, leaving unobserved grants reserved', () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Observed repository', path: process.cwd() });
    const resource = db.resources.register({
      projectId: project.id,
      kind: 'environment',
      identity: { composeProject: 'contract-environment' },
      owner: { kind: 'task', id: 'observed' },
      purpose: 'task',
      ownership: 'registered',
      preservation: 'disposable',
      generation: 1,
      consumers: [],
      state: 'available',
      objectIds: ['exact-object'],
    });
    const cost: ResourceCost = {
      ramBytes: 400,
      cpuMillis: 100,
      environment: 1,
      model: 0,
      review: 0,
      build: 0,
      diskBytes: {},
    };
    for (const id of ['first', 'second']) {
      const lease = db.admission.request({
        id,
        projectId: project.id,
        ownerId: 'environment:observed',
        intentId: id,
        checkpoint: 'environment',
        cost,
        locks: [],
      });
      expect(
        db.admission.admit(project.id, id, lease.revision, {
          ...cost,
          ramBytes: 1000,
          cpuMillis: 1000,
          environment: 3,
          accounts: {},
          measuredAt: Date.now(),
          maxAgeMs: 5000,
        }).state,
      ).toBe('granted');
    }
    const usage = [
      {
        id: 'exact-object',
        project: resource.identity.composeProject,
        ramBytes: 300,
        cpuMillis: 50,
      },
    ];
    expect(Object.keys(observedEnvironmentUsage(db, usage))).toEqual(['first']);
    expect(observedEnvironmentUsage(db, usage).first?.ramBytes).toBe(300);
    expect(observedEnvironmentUsage(db, [{ ...usage[0]!, id: 'other-object' }])).toEqual({});
    expect(observedEnvironmentUsage(db, [{ ...usage[0]!, project: 'other-project' }])).toEqual({});
  } finally {
    db.close();
  }
});
