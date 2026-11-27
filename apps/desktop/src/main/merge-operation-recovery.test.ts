import { randomUUID } from 'node:crypto';
import { AppDb, git } from '@skaro/core';
import { expect, it } from 'vitest';
import { recoverMergeOperation } from './merge-operation-recovery';
import { coordinationHash, coordinationRequest } from './project-coordinator-request';
import { ProjectContext } from './projects';
import type { CompletionOperation } from './completion-store';

it('confirms only an exactly linked publication whose commit is present on the Git base', async () => {
  const db = AppDb.open(':memory:');
  try {
    const root = (await git(process.cwd(), ['rev-parse', '--show-toplevel'])).stdout.trim();
    const commit = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const project = db.addProject({ name: 'Skaro', path: root });
    const context = new ProjectContext(
      project.id,
      root,
      () => undefined,
      () => ({}),
    );
    const operation = db.coordination.accept(
      coordinationRequest({
        id: randomUUID(),
        projectId: project.id,
        action: 'mcp.merge_task',
        source: { kind: 'worker', id: 'run' },
        subject: { kind: 'task', id: 'T-020' },
        inputHash: coordinationHash(commit),
        mode: 'mutation',
        scopeKey: 'project',
      }),
    );
    db.coordination.claim(project.id, operation.id, {
      expectedRevision: operation.revision,
      claimId: randomUUID(),
    });
    db.coordination.recover(project.id);
    const publication: CompletionOperation = {
      id: randomUUID(),
      base: 'HEAD',
      commit,
      state: 'completed',
      strategy: 'merge',
      results: [
        {
          taskId: 'T-020',
          branch: 'HEAD',
          criteria: commit,
          head: commit,
          message: 'Observed Git commit',
        },
      ],
    };
    await expect(recoverMergeOperation(db, context, publication)).resolves.toBeUndefined();
    expect(db.coordination.getOperation(project.id, operation.id)?.state).toBe('uncertain');
    await expect(
      recoverMergeOperation(db, context, { ...publication, mergeRequestId: operation.id }),
    ).resolves.toMatchObject({
      id: operation.id,
      state: 'succeeded',
      evidence: { code: 'task_merge_publication_verified' },
    });
  } finally {
    db.close();
  }
});
