import { randomUUID } from 'node:crypto';
import type { C4Model, C4Package } from './model.ts';
import { C4_MODEL_PATH } from './model.ts';
import { readC4Model } from './shape.ts';
import { validateC4Model } from './validate.ts';
import { C4_DOCUMENT_PATH, c4BodyHash, validateC4Documents } from './documents.ts';
import { authoredBody } from './render.ts';
import { readC4Documents, validateC4Code } from './project.ts';
import { readC4File, withC4Lock } from './io.ts';
import { recoverC4Transaction } from './transaction.ts';
import { applyC4Replacements } from './replacements.ts';

export interface PrepareC4Package {
  title: string;
  summary: string;
  baseRevision: number;
  model: unknown;
  documents: { path: string; content: string }[];
  locale: string;
  task?: C4Package['task'];
  /** Task proposals validate code paths against their real worktree. */
  codeRoot?: string;
  /** Git publication validates newly current code in its assembled candidate before commit. */
  deferCodeValidation?: boolean;
}

export async function prepareC4Package(root: string, args: PrepareC4Package): Promise<C4Package> {
  return withC4Lock(root, async () => {
    await recoverC4Transaction(root);
    const raw = await readC4File(root, C4_MODEL_PATH);
    const previous = raw === null ? undefined : readC4Model(JSON.parse(raw));
    if ((previous?.revision ?? 0) !== args.baseRevision)
      throw new Error('C4: model changed; read context and prepare the package again');
    const model: C4Model = structuredClone(readC4Model(args.model));
    if (model.revision !== args.baseRevision + 1)
      throw new Error('C4: revision must be baseRevision + 1');
    if (!args.title.trim() || !args.summary.trim())
      throw new Error('C4: title and summary are required');
    const before = await readC4Documents(root);
    const after = new Map(before);
    const changed = new Set<string>();
    for (const doc of args.documents) {
      if (!C4_DOCUMENT_PATH.test(doc.path))
        throw new Error(`C4: invalid document path ${doc.path}`);
      if (changed.has(doc.path)) throw new Error(`C4: duplicate document ${doc.path}`);
      changed.add(doc.path);
      after.set(doc.path, authoredBody(doc.content) + '\n');
    }
    if (!after.has('architecture.md'))
      throw new Error('C4: architecture.md is required in the first package');
    applyC4Replacements(after, changed);
    for (const spec of model.specifications) {
      const text = after.get(spec.path);
      // The service binds the submitted content, never a hash guessed by the model.
      if (text && changed.has(spec.path)) spec.bodyHash = c4BodyHash(text);
    }
    const problems = [
      ...validateC4Model(model),
      ...validateC4Documents(model, after),
      ...(args.deferCodeValidation
        ? []
        : await validateC4Code(args.task ? root : (args.codeRoot ?? root), model)),
    ];
    // Moving an element preserves identity; reusing its ID for another kind does not.
    for (const element of previous?.elements ?? []) {
      const next = model.elements.find((e) => e.id === element.id);
      if (next && next.kind !== element.kind)
        problems.push(`${element.id}: existing identifier cannot change kind`);
      if (
        args.task &&
        element.state === 'current' &&
        (!next ||
          JSON.stringify({ ...element, planned: undefined }) !==
            JSON.stringify({ ...next, planned: undefined }))
      )
        problems.push(
          `${element.id}: a task must preserve current facts and propose planned edits/removals until publication`,
        );
    }
    if (args.task) {
      for (const element of model.elements)
        if (!previous?.elements.some((e) => e.id === element.id) && element.state !== 'planned')
          problems.push(`${element.id}: new task architecture must be planned until publication`);
      for (const relationship of previous?.relationships ?? []) {
        const next = model.relationships.find((r) => r.id === relationship.id);
        if (
          relationship.state === 'current' &&
          (!next ||
            JSON.stringify({ ...relationship, planned: undefined }) !==
              JSON.stringify({ ...next, planned: undefined }))
        )
          problems.push(`${relationship.id}: preserve current relationships until publication`);
      }
      for (const relationship of model.relationships)
        if (
          !previous?.relationships.some((r) => r.id === relationship.id) &&
          relationship.state !== 'planned'
        )
          problems.push(
            `${relationship.id}: new task relationship must be planned until publication`,
          );
    }
    if (problems.length) throw new Error(problems.join('\n'));
    const files = [...after]
      .filter(([path, content]) => before.get(path) !== content)
      .map(([path, content]) => ({ path, before: before.get(path) ?? null, after: content }));
    files.push({ path: C4_MODEL_PATH, before: raw, after: JSON.stringify(model, null, 2) + '\n' });
    return {
      id: randomUUID(),
      title: args.title,
      summary: args.summary,
      baseRevision: args.baseRevision,
      files,
      ...(args.task ? { task: args.task } : {}),
    };
  });
}

export function c4PackageText(pkg: C4Package, side: 'before' | 'after'): string {
  return pkg.files
    .map(
      (file) =>
        `# .skaro/${file.path}\n\n${
          file.path.endsWith('.json')
            ? '\x60\x60\x60json\n' + (file[side] ?? '(absent)') + '\n\x60\x60\x60'
            : (file[side] ?? '(absent)')
        }\n`,
    )
    .join('\n---\n\n');
}
