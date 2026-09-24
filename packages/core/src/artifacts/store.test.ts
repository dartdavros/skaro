import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore, taskBranch } from './store.ts';
import { slugify } from './slug.ts';

let root: string;
let store: ArtifactStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skaro-core-'));
  store = new ArtifactStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('ArtifactStore', () => {
  it('loads an empty project with defaults', async () => {
    const project = await store.load();
    expect(project.tasks).toEqual([]);
    expect(project.config.baseBranch).toBe('main');
    expect(project.config.merge).toEqual({ strategy: 'squash', deleteBranch: true });
    expect(project.problems).toEqual([]);
  });

  it('creates tasks with sequential ids and slugged file names', async () => {
    const a = await store.createTask({ title: 'Авторизация по email', created: '2026-09-24' });
    const b = await store.createTask({ title: 'Password reset', dependsOn: [a.id] });
    expect(a.id).toBe('T-001');
    expect(a.path).toBe('.skaro/tasks/T-001-avtorizatsiya-po-email.md');
    expect(b.id).toBe('T-002');
    expect(b.dependsOn).toEqual(['T-001']);
    const text = await readFile(join(root, a.path), 'utf8');
    expect(text).toMatch(
      /^---\nid: T-001\ntitle: Авторизация по email\nstatus: todo\ndepends_on: \[\]\ncreated: 2026-09-24\n---\n/,
    );
    expect(text).toContain('## Цель');
  });

  it('updates fields without losing manual formatting and comments', async () => {
    await mkdir(join(root, '.skaro/tasks'), { recursive: true });
    const manual = [
      '---',
      'id: T-007',
      'title: Manual task',
      'status: todo # edited by hand',
      'depends_on: []',
      'custom_field: keep me',
      '---',
      '## Цель',
      'Body written by the user.',
      '',
    ].join('\n');
    await writeFile(join(root, '.skaro/tasks/T-007-manual.md'), manual);

    await store.updateTask('T-007', { status: 'review', archived: true });
    const text = await readFile(join(root, '.skaro/tasks/T-007-manual.md'), 'utf8');
    expect(text).toContain('status: review # edited by hand');
    expect(text).toContain('custom_field: keep me');
    expect(text).toContain('archived: true');
    expect(text).toContain('Body written by the user.');

    await store.updateTask('T-007', { archived: false });
    expect(await readFile(join(root, '.skaro/tasks/T-007-manual.md'), 'utf8')).not.toContain(
      'archived',
    );
  });

  it('reports broken files as problems instead of failing', async () => {
    await mkdir(join(root, '.skaro/tasks'), { recursive: true });
    await writeFile(join(root, '.skaro/tasks/bad.md'), '---\nid: [unclosed\n---\n');
    await writeFile(
      join(root, '.skaro/tasks/T-001-a.md'),
      '---\nid: T-001\nstatus: weird\ndepends_on: [T-404]\n---\n',
    );
    await writeFile(join(root, '.skaro/tasks/T-001-b.md'), '---\nid: T-001\n---\n');
    const project = await store.load();
    expect(project.tasks.map((t) => t.status)).toEqual(['todo', 'todo']);
    const messages = project.problems.map((p) => p.message);
    expect(messages.some((m) => m.includes('unknown status "weird"'))).toBe(true);
    expect(messages).toContain('unknown dependency T-404');
    expect(messages.some((m) => m.startsWith('duplicate task id T-001'))).toBe(true);
    expect(project.problems.some((p) => p.path === '.skaro/tasks/bad.md')).toBe(true);
  });

  it('deletes a task and removes it from dependencies', async () => {
    const a = await store.createTask({ title: 'A' });
    const b = await store.createTask({ title: 'B', dependsOn: [a.id] });
    await store.deleteTask(a.id);
    const project = await store.load();
    expect(project.tasks.map((t) => t.id)).toEqual([b.id]);
    expect(project.tasks[0]?.dependsOn).toEqual([]);
  });

  it('manages milestones and moves tasks when one is deleted', async () => {
    const m1 = await store.createMilestone({ title: 'Базовый API' });
    const m2 = await store.createMilestone({ title: 'UI' });
    expect([m1.id, m1.order, m2.id, m2.order]).toEqual(['M01', 1, 'M02', 2]);
    const task = await store.createTask({ title: 'Endpoint', milestone: m1.id });
    await store.deleteMilestone(m1.id, m2.id);
    expect((await store.readTask(task.id)).milestone).toBe(m2.id);
    expect((await store.load()).milestones.map((m) => m.id)).toEqual(['M02']);
  });

  it('supersedes an ADR when its replacement is accepted', async () => {
    const old = await store.createAdr({ title: 'Use REST', status: 'accepted' });
    const next = await store.createAdr({ title: 'Use GraphQL', replaces: old.id });
    expect(next.status).toBe('proposed');
    await store.setAdrStatus(next.id, 'accepted');
    const adrs = (await store.load()).adrs;
    expect(adrs.find((a) => a.id === old.id)).toMatchObject({
      status: 'superseded',
      replacedBy: next.id,
    });
  });

  it('writes documents and reads their titles', async () => {
    await store.writeDoc('brief.md', '# Калькулятор\n\nЧто строим.\n');
    await store.writeDoc('docs/notes.md', 'no heading');
    const project = await store.load();
    expect(project.brief?.title).toBe('Калькулятор');
    expect(project.docs.map((d) => d.title)).toEqual(['notes']);
    await expect(store.writeDoc('../escape.md', 'x')).rejects.toThrow('not a document path');
  });

  it('round-trips the project config', async () => {
    const config = (await store.load()).config;
    await store.writeConfig({
      ...config,
      baseBranch: 'develop',
      merge: { strategy: 'merge', deleteBranch: false },
    });
    const reread = (await store.load()).config;
    expect(reread.baseBranch).toBe('develop');
    expect(reread.merge).toEqual({ strategy: 'merge', deleteBranch: false });
    expect(taskBranch(reread, { id: 'T-012', title: 'Авторизация по email' })).toBe(
      'skaro/T-012-avtorizatsiya-po-email',
    );
  });

  it('reports manual edits but not its own writes', async () => {
    const task = await store.createTask({ title: 'Watched' });
    const changes: string[][] = [];
    const stop = store.watch((paths) => changes.push(paths), 50);
    try {
      await store.updateTask(task.id, { status: 'review' });
      await new Promise((r) => setTimeout(r, 300));
      expect(changes).toEqual([]);

      const path = join(root, task.path);
      await writeFile(
        path,
        (await readFile(path, 'utf8')).replace('status: review', 'status: done'),
      );
      await new Promise((r) => setTimeout(r, 300));
      expect(changes.flat()).toContain('tasks/T-001-watched.md');
    } finally {
      stop();
    }
  });
});

describe('slugify', () => {
  it('transliterates and trims', () => {
    expect(slugify('Авторизация по email!')).toBe('avtorizatsiya-po-email');
    expect(slugify('  ---  ')).toBe('untitled');
    expect(slugify('Ёлка и щука')).toBe('elka-i-schuka');
  });
});

describe('frontmatter', () => {
  it('reads files saved with a byte order mark', async () => {
    const { parseMarkdown, getFields } = await import('./frontmatter.ts');
    const file = parseMarkdown(`${String.fromCharCode(0xfeff)}---\nid: T-001\n---\nbody\n`);
    expect(getFields(file)).toEqual({ id: 'T-001' });
    expect(file.body).toBe('body\n');
  });
});
