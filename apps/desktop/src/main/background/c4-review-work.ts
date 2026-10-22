import {
  reviewC4Package,
  c4PackageModels,
  c4ReviewDocument,
  c4ModelChanges,
  type C4Package,
  type C4PackageReview,
} from '@skaro/core';
import { compareText } from '@skaro/timeline';
import type { C4ReviewMethods } from '../../shared/c4-review';

/** All review data comes from immutable package bytes, never the live checkout. */
export function c4ReviewWork(read: (project: string, id: string, paths?: string[]) => C4Package) {
  // Package IDs are immutable. Keep bounded, small summaries, never model/document bodies.
  const summaries = new Map<string, C4PackageReview>();
  return {
    'c4.review': (project, id) => {
      const key = `${project}\0${id}`;
      let summary = summaries.get(key);
      if (!summary) {
        summary = reviewC4Package(read(project, id));
        if (summaries.size >= 16) summaries.delete(summaries.keys().next().value!);
        summaries.set(key, summary);
      }
      return summary;
    },
    'c4.reviewDetail': (project, id, key) => {
      const path = key.startsWith('document:')
        ? key.slice('document:'.length)
        : key.startsWith('generated:')
          ? key.slice('generated:'.length)
          : 'c4/model.json';
      const pkg = read(project, id, [path]);
      if (key.startsWith('document:')) return c4ReviewDocument(pkg, key.slice('document:'.length));
      if (key.startsWith('generated:')) {
        const file = pkg.files.find((f) => f.path === key.slice('generated:'.length));
        if (!file) throw new Error('Unknown generated document');
        // The physical write is available explicitly; it is never feed preview material.
        const before = file.before ?? '',
          after = file.after;
        return { before, after, comparison: compareText(before, after) };
      }
      const models = c4PackageModels(pkg);
      const entry = c4ModelChanges(models.before, models.after).find((c) => c.key === key);
      if (!entry) throw new Error('Unknown C4 change');
      return {
        before: entry.before,
        after: entry.after,
        comparison: compareText(entry.before, entry.after),
      };
    },
    'c4.reviewModel': (project, id, side) =>
      c4PackageModels(read(project, id, ['c4/model.json']))[side] ?? null,
  } satisfies C4ReviewMethods;
}
