import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ProjectContext } from './projects';

let root: string;
let context: ProjectContext | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skaro-project-watch-'));
});

afterEach(async () => {
  context?.close();
  context = undefined;
  await rm(root, { recursive: true, force: true });
});

async function brief(): Promise<string | undefined> {
  return (await context!.load()).brief?.body;
}

it('invalidates the empty cache when .skaro appears, then follows external edits', async () => {
  context = new ProjectContext(
    'project',
    root,
    () => undefined,
    () => ({}),
  );
  expect(await brief()).toBeUndefined();

  await mkdir(join(root, '.skaro'));
  const path = join(root, '.skaro', 'brief.md');
  await writeFile(path, '# Created\n');
  await expect.poll(brief, { timeout: 3000 }).toBe('# Created\n');

  await writeFile(path, '# Edited outside Skaro\n');
  await expect.poll(brief, { timeout: 3000 }).toBe('# Edited outside Skaro\n');
});

it('follows a removed and recreated .skaro directory without reopening the project', async () => {
  const directory = join(root, '.skaro');
  await mkdir(directory);
  await writeFile(join(directory, 'brief.md'), '# Original\n');
  context = new ProjectContext(
    'project',
    root,
    () => undefined,
    () => ({}),
  );
  expect(await brief()).toBe('# Original\n');

  await rm(directory, { recursive: true });
  await expect.poll(brief, { timeout: 3000 }).toBeUndefined();
  await mkdir(directory);
  await writeFile(join(directory, 'brief.md'), '# Replacement\n');
  await expect.poll(brief, { timeout: 3000 }).toBe('# Replacement\n');

  await writeFile(join(directory, 'brief.md'), '# Replacement edited\n');
  await expect.poll(brief, { timeout: 3000 }).toBe('# Replacement edited\n');
});

it('does not notify a closed project when .skaro is created afterwards', async () => {
  let changes = 0;
  context = new ProjectContext(
    'project',
    root,
    () => changes++,
    () => ({}),
  );
  context.close();
  await mkdir(join(root, '.skaro'));
  await writeFile(join(root, '.skaro', 'brief.md'), '# After close\n');
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(changes).toBe(0);
});
