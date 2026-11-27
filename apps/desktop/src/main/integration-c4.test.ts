import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CompletionFixture } from './completion-test-support';
import { conflictingResults, stageResolution, behaviorCheck } from './integration-test-support';
import { IntegrationPending } from './integration-model';
let f: CompletionFixture;
beforeEach(async () => {
  f = await CompletionFixture.create();
});
afterEach(async () => {
  await f.close();
}, 60_000);

async function reference(path: string) {
  const file = join(f.repo, '.skaro/c4/model.json');
  const model = JSON.parse(await readFile(file, 'utf8'));
  model.elements[0].code = [path];
  await writeFile(file, JSON.stringify(model));
  f.context.invalidate();
}

async function candidate() {
  await reference('README.md');
  const { results } = await conflictingResults(f);
  await expect(
    f.integrations.prepare({
      projectId: f.projectId,
      taskId: results[0]!.taskId,
      purpose: 'publication',
      base: 'main',
      results,
      checks: [],
      publish: true,
    }),
  ).rejects.toBeInstanceOf(IntegrationPending);
  const op = f.integrations.deps.store.all(f.projectId)[0]!;
  await stageResolution(op);
  return op;
}

it.each(['rename', 'delete'] as const)(
  'publishes a verified %s after restart while retaining the manual C4 model',
  async (action) => {
    const op = await candidate();
    const file = join(f.repo, '.skaro/c4/model.json');
    const model = await readFile(file, 'utf8');
    await git(
      op.worktree,
      action === 'rename' ? ['mv', 'README.md', 'renamed.md'] : ['rm', 'README.md'],
    );
    await f.integrations.verify(op, [behaviorCheck], {});
    const head = op.head;
    await f.restart();
    const restored = f.integrations.deps.store.find(f.projectId, op.id)!;
    expect(restored.head).toBe(head);
    await f.coordinator.publishCandidate(restored);
    expect(restored.state).toBe('applied');
    expect(await readFile(file, 'utf8')).toBe(model);
    expect((await git(f.repo, ['diff', 'HEAD', op.baseHead, '--', '.skaro/c4'])).stdout).toBe('');
    await expect(readFile(join(f.repo, 'README.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    if (action === 'rename')
      expect(await readFile(join(f.repo, 'renamed.md'), 'utf8')).toBe('initial\n');
  },
  60_000,
);
