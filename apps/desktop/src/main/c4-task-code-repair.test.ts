import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { git, validateC4Code, type C4Model } from '@skaro/core';
import { validateC4TaskCode } from './c4-task-code';
import { readTaskC4Scope } from './c4-task-scope';

const root = process.env.SKARO_C4_REPAIR_ROOT;
const worktrees = process.env.SKARO_C4_REPAIR_WORKTREES;

// Opt-in read-only diagnosis of the existing tasks being repaired. No service/agent is started.
it.skipIf(!root || !worktrees)(
  'checks the existing blocked checkouts without changing them',
  async () => {
    const model = JSON.parse(
      await readFile(join(root!, '.skaro/c4/model.json'), 'utf8'),
    ) as C4Model;
    for (const id of ['T-175', 'T-179']) {
      const checkout = join(worktrees!, id);
      const before = (await git(checkout, ['status', '--porcelain'])).stdout;
      expect(before).toBe('');
      const base = (await git(checkout, ['rev-parse', 'main'])).stdout.trim();
      const scope = await readTaskC4Scope(checkout, base, { c4: model, tasks: [] }, id);
      expect(scope.files).not.toContain('apps/backend/chatballs/webchat/site_events.py');
      const oldProblems = await validateC4Code(checkout, model);
      expect(oldProblems.some((problem) => problem.includes('site_events.py'))).toBe(true);
      const problems = await validateC4TaskCode(checkout, base, model, scope.files, []);
      console.log(id, JSON.stringify({ original: oldProblems.length, remaining: problems }));
      expect(problems).toEqual([]);
      expect((await git(checkout, ['status', '--porcelain'])).stdout).toBe(before);
    }
  },
  30_000,
);
