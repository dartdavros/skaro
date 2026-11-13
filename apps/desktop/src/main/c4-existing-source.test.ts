import { expect, it } from 'vitest';
import { readFile, realpath } from 'node:fs/promises';
import { skaroC4 } from '../../../../docs/c4/skaro-model';
import { inspectExistingC4Source } from './c4-existing-source';

it('cannot use the task checkout itself to certify an arbitrary new file as pre-existing', async () => {
  const root = await realpath(process.cwd());
  const source = skaroC4.elements.find((e) => e.state === 'current' && e.code.length)!;
  expect(source).toBeDefined();
  await expect(
    inspectExistingC4Source(root, source.code[0]!, { root, model: skaroC4 }),
  ).resolves.toBeUndefined();
});

it('cannot certify absent or planned-only architecture as an existing current source', async () => {
  const root = await realpath(process.cwd());
  const path = 'AGENTS.md';
  const model = structuredClone(skaroC4);
  for (const element of model.elements) element.state = 'planned';
  await expect(inspectExistingC4Source(root, path, { root, model })).resolves.toBeUndefined();
  await expect(inspectExistingC4Source(root, path)).resolves.toBeUndefined();
});

it('rejects byte differences between two actual project documents, even with a current binding', async () => {
  const root = await realpath(process.cwd()),
    checkout = await realpath('apps/desktop');
  expect((await readFile('AGENTS.md')).equals(await readFile('apps/desktop/AGENTS.md'))).toBe(
    false,
  );
  const model = structuredClone(skaroC4);
  model.elements.find((e) => e.state === 'current')!.code = ['AGENTS.md'];
  await expect(
    inspectExistingC4Source(checkout, 'AGENTS.md', { root, model }),
  ).resolves.toBeUndefined();
});
