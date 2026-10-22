import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { C4Package } from './model.ts';
import { reviewC4Package, c4ReviewDocument, c4PackageModels } from './package-review.ts';
import { c4ModelChanges } from './review-model.ts';
import { architecturePresentation, diffPreview, type Item } from '@skaro/timeline';

const database = process.env['SKARO_C4_REVIEW_DB'];
const itemId = process.env['SKARO_C4_REVIEW_ID'];
const root = process.env['SKARO_C4_REVIEW_ROOT'];

/** Opt-in read-only regression against a real saved package. No fixtures or artifact writes. */
describe.runIf(!!database && !!itemId && !!root)('saved architecture package', () => {
  it('separates authored edits from generated copies without changing saved data', async () => {
    const db = new DatabaseSync(database!, { readOnly: true });
    let pkg: C4Package;
    try {
      const row = db.prepare('SELECT state,metadata,payload FROM records WHERE id=?').get(itemId!);
      expect(row).toBeDefined();
      const item = (
        JSON.parse(String(row!['metadata'])) as { item: Extract<Item, { kind: 'proposal' }> }
      ).item;
      expect(item.proposal.type).toBe('architecture');
      if (item.proposal.type === 'architecture') {
        const presentation = architecturePresentation(item.proposal, item.id);
        expect(presentation.files).toBeUndefined();
        expect(presentation.preview).toBeUndefined();
        expect(JSON.stringify(presentation).length).toBeLessThan(4096);
      }
      const stored = JSON.parse(String(row!['payload'])) as C4Package;
      const content = (id: string) =>
        String(db.prepare('SELECT text FROM content WHERE id=?').get(id)!['text']);
      pkg = {
        ...stored,
        files: stored.files.map((file) => ({
          path: file.path,
          before: file.before === null ? null : content(file.before),
          after: content(file.after),
        })),
      };
    } finally {
      db.close();
    }
    const diskText = (path: string) =>
      readFile(join(root!, '.skaro', path), 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    const diskBefore = await Promise.all(pkg.files.map((file) => diskText(file.path)));
    const original = JSON.stringify(pkg);
    const review = reviewC4Package(pkg);
    const architecture = pkg.files.find((f) => f.path === 'architecture.md')!;
    const preview = diffPreview(architecture.before!, architecture.after);
    expect(preview.unavailable).toBe(false);
    expect(preview.lines.reduce((length, line) => length + line.text.length, 0)).toBeLessThan(1820);
    expect(review.documents).toHaveLength(9);
    expect(review.generated).toHaveLength(34);
    const counts = review.documents.reduce(
      (sum, document) => {
        expect(document.comparison.status).toBe('exact');
        if (document.comparison.status === 'exact') {
          sum.added += document.comparison.added;
          sum.removed += document.comparison.removed;
        }
        const detail = c4ReviewDocument(pkg, document.path);
        expect(detail.before).not.toContain('```skaro-c4');
        expect(detail.after).not.toContain('```skaro-c4');
        return sum;
      },
      { added: 0, removed: 0 },
    );
    expect(counts).toEqual({ added: 95, removed: 34 });
    expect(
      review.model.filter(
        (c) => ['elements', 'relationships', 'views'].includes(c.group) && c.operation === 'remove',
      ),
    ).toEqual([]);
    const models = c4PackageModels(pkg);
    expect(
      c4ModelChanges(models.before, models.after).filter((c) => c.operation === 'add'),
    ).toHaveLength(4);
    expect(JSON.stringify(pkg)).toBe(original);
    expect(await Promise.all(pkg.files.map((file) => diskText(file.path)))).toEqual(diskBefore);
  }, 30_000);
});
