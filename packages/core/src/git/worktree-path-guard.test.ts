import { expect, it } from 'vitest';
import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { WorktreePathGuard } from './worktree-path-guard.ts';

it('rechecks current consumers and exact canonical ancestors against the actual repository without writes', async () => {
  const root = await realpath(process.cwd());
  let consumed = false;
  const scope = new WorktreePathGuard(root, () => {
    if (consumed) throw new Error('New checkout consumer');
  });
  await scope.directory(root, true);
  await scope.leaf(join(root, 'package.json'));
  await expect(scope.directory(dirname(root))).rejects.toThrow('escaped its registered root');
  consumed = true;
  await expect(scope.leaf(join(root, 'package.json'))).rejects.toThrow('New checkout consumer');
});
