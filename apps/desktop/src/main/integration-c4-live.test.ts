import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { realizeC4, validateC4Code, type C4Model } from '@skaro/core';
import type { IntegrationOperation } from './integration-model';
import { assertCandidateC4, candidateC4Model } from './c4-candidate';

const profile = process.env['SKARO_C4_VERIFY_DB'];
const operation = process.env['SKARO_C4_VERIFY_OPERATION'];

it.skipIf(!profile || !operation)(
  'repairs the actual retained C4 rename without changing its code or planned scope',
  async () => {
    const db = new DatabaseSync(profile!, { readOnly: true });
    try {
      const row = db.prepare('SELECT value FROM collection_records WHERE id = ?').get(operation!)!;
      const op = JSON.parse(String(row['value'])) as IntegrationOperation;
      const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(op.projectId)!;
      const model: C4Model = JSON.parse(
        await readFile(join(String(project['path']), '.skaro/c4/model.json'), 'utf8'),
      );
      const realized = op.results.flatMap((result) => result.c4?.realized ?? []);
      const candidate = {
        root: op.worktree,
        base: op.baseHead,
        head: op.publicationHead ?? op.head,
      };
      const before = await validateC4Code(op.worktree, realizeC4(model, realized));
      expect(before).toContain('identity: missing code path backend/apps/identity/models.py');
      expect(before).toContain(
        'baseline-code-identity: missing code path backend/apps/identity/models.py',
      );
      const after = await candidateC4Model(model, realized, candidate);
      await assertCandidateC4(after, candidate);
      for (const id of ['identity', 'baseline-code-identity'])
        expect(after.elements.find((item) => item.id === id)?.code).toEqual([
          'backend/apps/identity/models/users.py',
        ]);
      expect(after.elements.find((item) => item.id === 'identity')?.planned).toEqual(
        model.elements.find((item) => item.id === 'identity')?.planned,
      );
      console.log({ operation: op.id, head: candidate.head, before, after: [], writes: 0 });
    } finally {
      db.close();
    }
  },
  30_000,
);
