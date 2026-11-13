import { readFile, realpath } from 'node:fs/promises';
import { c4Hash, git } from '@skaro/core';
import type { C4ImpactObservation } from './c4-impact-observation';

/** Actual repository observations for pure protocol checks; no project, task or backend is seeded. */
export async function semanticTestObservation(): Promise<C4ImpactObservation> {
  const root = await realpath(process.cwd());
  const path = 'apps/desktop/src/main/c4-service.ts';
  const hash = c4Hash(await readFile(path, 'utf8'));
  const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const owner = { projectId: root, taskId: 'C4-2', runId: head };
  return {
    version: 1,
    head,
    runHash: c4Hash(head),
    intent: 1,
    resource: { id: root, generation: 1, identityHash: c4Hash(root) },
    architectureHash: c4Hash('docs/c4/skaro-model.ts'),
    inputs: {
      projectId: root,
      taskId: owner.taskId,
      version: hash,
      requirements: hash,
      dependencies: [],
      environment: hash,
      checks: hash,
      workflow: hash,
      authority: hash,
    },
    scope: {
      kind: 'implementation',
      files: [path],
      requirements: [],
      elements: ['serviceclass'],
      relationships: [],
    },
    files: [{ path, hash }],
    impact: {
      version: 1,
      ...owner,
      checkout: root,
      baseHead: head,
      changeHash: hash,
      scopeHash: hash,
      expectedRevision: 1,
      requirements: [],
      elements: ['serviceclass'],
      relationships: [],
      sources: [{ path, hash }],
      checks: [],
      discrepancies: [],
    },
  };
}
