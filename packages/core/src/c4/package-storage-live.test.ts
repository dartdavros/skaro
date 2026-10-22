import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readC4Model } from './shape.ts';
import { readC4Documents } from './project.ts';
import { prepareC4Package } from './package.ts';
import { prepareC4DocumentMigration } from './document-migration.ts';
import { readC4DocumentSnapshot } from './document-snapshot.ts';
import { authoredBody } from './render.ts';

const root = process.env['SKARO_C4_SOURCE_ROOT'];

// Existing accepted architecture and real source checkout; no generated fixture project.
it.skipIf(!root)(
  'prepares source-only packages and an explicit migration without touching accepted files',
  async () => {
    const source = await readFile(join(root!, '.skaro/c4/model.json'), 'utf8');
    const model = readC4Model(JSON.parse(source));
    const before = await readC4Documents(root!);
    const pkg = await prepareC4Package(root!, {
      title: model.title,
      summary: 'Review the existing accepted model revision.',
      baseRevision: model.revision,
      model: { ...model, revision: model.revision + 1 },
      documents: [],
      locale: 'ru',
    });
    expect(pkg.files.map((f) => f.path)).toEqual(['c4/model.json']);
    const snapshot = await readC4DocumentSnapshot(root!, 'architecture.md');
    expect(snapshot.body).not.toContain('```skaro-c4');
    expect(snapshot.attachment?.model).toEqual(model);
    expect(snapshot.attachment?.views).toEqual(model.views.map((v) => v.id));
    const migration = await prepareC4DocumentMigration(root!, 'ru');
    if ([...before.values()].some((text) => text.includes('<!-- skaro:c4:start -->'))) {
      expect(migration).toBeDefined();
      for (const file of migration!.files.filter((f) => f.path !== 'c4/model.json')) {
        expect(file.after).not.toContain('```skaro-c4');
        expect(authoredBody(file.after)).toBe(authoredBody(file.before!));
      }
    } else expect(migration).toBeUndefined();
    expect(await readFile(join(root!, '.skaro/c4/model.json'), 'utf8')).toBe(source);
    expect(await readC4Documents(root!)).toEqual(before);
  },
  30_000,
);
