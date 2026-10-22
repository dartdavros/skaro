import type { C4ReviewDocument, C4PackageReview } from './review-types.ts';
import { compareText } from '@skaro/timeline';
import type { C4Model, C4Package } from './model.ts';
import { C4_MODEL_PATH } from './model.ts';
import { readC4Model } from './shape.ts';
import { authoredBody } from './render.ts';
import { c4Hash } from './documents.ts';
import { c4ModelChanges } from './review-model.ts';

export function c4PackageModels(pkg: C4Package): { before?: C4Model; after: C4Model } {
  const file = pkg.files.find((f) => f.path === C4_MODEL_PATH);
  if (!file) throw new Error('C4 package has no model snapshot');
  return {
    before: file.before === null ? undefined : readC4Model(JSON.parse(file.before)),
    after: readC4Model(JSON.parse(file.after)),
  };
}
export function c4ReviewDocument(pkg: C4Package, path: string) {
  const file = pkg.files.find((f) => f.path === path);
  if (!file || path === C4_MODEL_PATH) throw new Error('Unknown C4 document');
  const before = file.before === null ? '' : authoredBody(file.before) + '\n';
  const after = authoredBody(file.after) + '\n';
  return { before, after, comparison: compareText(before, after) };
}
export function reviewC4Package(pkg: C4Package): C4PackageReview {
  const documents: C4ReviewDocument[] = [],
    generated: string[] = [];
  for (const file of pkg.files) {
    if (file.path === C4_MODEL_PATH) continue;
    if (file.before !== null && authoredBody(file.before) === authoredBody(file.after)) {
      generated.push(file.path);
      continue;
    }
    const { comparison } = c4ReviewDocument(pkg, file.path);
    documents.push({
      path: file.path,
      operation: file.before === null ? 'add' : 'update',
      beforeHash: file.before === null ? null : c4Hash(file.before),
      afterHash: c4Hash(file.after),
      comparison:
        comparison.status === 'exact'
          ? { status: 'exact', added: comparison.added, removed: comparison.removed }
          : comparison,
    });
  }
  const model = c4PackageModels(pkg);
  return {
    packageId: pkg.id,
    fingerprint: c4Hash(JSON.stringify(pkg)),
    baseRevision: pkg.baseRevision,
    revision: model.after.revision,
    documents,
    generated,
    model: c4ModelChanges(model.before, model.after).map(
      ({ before: _a, after: _b, ...change }) => change,
    ),
  };
}
