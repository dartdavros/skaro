import { AppDb, git, type Task } from '@skaro/core';
import { expect, it } from 'vitest';
import { taskC4Base } from './c4-task-base';
import { criteriaRevision } from './completion-store';

it('advances the C4 baseline only to a current accepted in-place input already in HEAD', async ({
  skip,
}) => {
  const checkout = process.cwd();
  const rev = async (ref: string) => (await git(checkout, ['rev-parse', ref])).stdout.trim();
  if ((await rev('--is-shallow-repository')) === 'true') skip('Requires existing Git ancestry');
  const [baseBranch, acceptedHead] = await Promise.all([rev('HEAD~2'), rev('HEAD~1')]);
  const dependency: Task = {
    id: 'T-005',
    title: 'Accepted dependency',
    status: 'done',
    dependsOn: [],
    body: '',
    path: '.skaro/tasks/T-005.md',
    unblocked: false,
    archived: false,
  };
  const artifacts = {
    config: { baseBranch },
    tasks: [
      dependency,
      { ...dependency, id: 'T-019', status: 'in_progress' as const, dependsOn: [dependency.id] },
    ],
  };
  const owner = { projectId: 'project', taskId: 'T-019', runId: 'run', checkout, inPlace: true };
  const db = AppDb.open(':memory:');
  try {
    db.setSetting('coordination.inputs.run', {
      projectId: owner.projectId,
      taskId: owner.taskId,
      dependencies: [
        {
          taskId: dependency.id,
          status: dependency.status,
          head: acceptedHead,
          criteria: criteriaRevision(dependency),
        },
      ],
    });
    expect(await taskC4Base(db, artifacts, owner)).toBe(acceptedHead);
    expect(await taskC4Base(db, artifacts, { ...owner, inPlace: false })).toBe(baseBranch);
    dependency.title = 'Changed since dispatch';
    expect(await taskC4Base(db, artifacts, owner)).toBe(baseBranch);
  } finally {
    db.close();
  }
});
