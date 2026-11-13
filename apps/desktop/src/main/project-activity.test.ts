import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { projectActivityPage } from './project-activity';

it('projects only confirmed scoped ledger facts and retains completed job identity across restart', () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Repository metadata', path: process.cwd() });
    const separate = db.addProject({
      name: 'Separate metadata',
      path: process.cwd() + '/packages/core',
    });
    db.addEvent(project.id, 'cache_evicted', {
      resource: 'observed-cache',
      beforeBytes: 42,
      afterBytes: 0,
    });
    db.addEvent(project.id, 'cache_evicted', {
      resource: 'unconfirmed-cache',
      beforeBytes: 42,
      afterBytes: 1,
    });
    db.addEvent(project.id, 'resource_lifecycle', {
      resource: 'unconfirmed-tree',
      step: 'worktree.remove',
      state: 'attempting',
    });
    db.addEvent(project.id, 'background_result', {
      job: {
        id: 'observed-job',
        projectId: project.id,
        what: 'environment.task',
        state: 'failed',
        startedAt: 1,
        endedAt: 2,
      },
    });
    db.addEvent(separate.id, 'waiting', { task: 'separate-task' });
    const first = projectActivityPage(db, project.id);
    expect(first.jobs.map((job) => job.what)).toEqual(['environment.task', 'cache.evicted']);
    expect(first.jobs[0]).toMatchObject({ id: 'observed-job', state: 'failed' });
    expect(projectActivityPage(db, project.id)).toEqual(first);
    db.shell.scopeTo(project.id);
    expect(() => projectActivityPage(db, separate.id)).toThrow('Activity project scope invalid');
  } finally {
    db.close();
  }
});
