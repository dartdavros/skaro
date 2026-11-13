import { readFile } from 'node:fs/promises';
import { git, type C4Model } from '@skaro/core';
import { requireMemoryPath } from './project-memory-sources';
import type { C4TaskScope } from './c4-task-scope';
import { inspectExistingC4Source, type C4ExistingSource } from './c4-existing-source';

export interface C4Preservation {
  moves: { from: string; to: string; blob: string }[];
  references: string[];
  existing?: C4ExistingSource[];
}

/** Only exact Git blob moves plus exact textual path replacements preserve existing behavior. */
export async function inspectC4Preservation(
  root: string,
  base: string,
  scope: C4TaskScope,
  baseline?: { root: string; model?: C4Model },
) {
  if (scope.requirements.length || !scope.files.length) return undefined;
  const ancestor = (await git(root, ['merge-base', base, 'HEAD'])).stdout.trim();
  const fields = (
    await git(root, [
      'diff',
      '--raw',
      '--no-abbrev',
      '-z',
      '--find-renames=100%',
      ancestor,
      '--',
      '.',
      ':(exclude).skaro',
    ])
  ).stdout.split('\0');
  const moves: C4Preservation['moves'] = [],
    references: string[] = [],
    existing: C4ExistingSource[] = [],
    paths: string[] = [];
  for (let i = 0; fields[i];) {
    const header = fields[i++]!.match(
      /^:(000000|100(?:644|755)) (100(?:644|755)) ([a-f0-9]{40,64}) [a-f0-9]{40,64} (R100|M|A)$/,
    );
    if (!header || (header[4] !== 'A' && header[1] !== header[2])) return undefined;
    const path = fields[i++]!;
    paths.push(path);
    if (header[4] === 'A') {
      if (header[1] !== '000000' || header[2] !== '100644') return undefined;
      const preserved = await inspectExistingC4Source(root, path, baseline);
      if (!preserved) return undefined;
      existing.push(preserved);
    } else if (header[4] === 'M') references.push(path);
    else {
      const to = fields[i++]!;
      paths.push(to);
      const bytes = await readFile(await requireMemoryPath(root, to));
      if (
        (
          await git(root, ['hash-object', `--path=${path}`, '--stdin'], { input: bytes })
        ).stdout.trim() !== header[3]
      )
        return undefined;
      moves.push({ from: path, to, blob: header[3]! });
    }
  }
  if (
    (!moves.length && !existing.length) ||
    paths.length !== scope.files.length ||
    scope.files.some((p) => !paths.includes(p))
  )
    return undefined;
  for (const path of references) {
    const before = (await git(root, ['show', `${ancestor}:${path}`])).stdout;
    const original = (await git(root, ['rev-parse', `${ancestor}:${path}`])).stdout.trim();
    // A lossy text decode must never certify binary contents.
    if ((await git(root, ['hash-object', '--stdin'], { input: before })).stdout.trim() !== original)
      return undefined;
    let after = before;
    for (const move of moves) after = after.replaceAll(move.from, move.to);
    const bytes = await readFile(await requireMemoryPath(root, path));
    const actual = (
      await git(root, ['hash-object', `--path=${path}`, '--stdin'], { input: bytes })
    ).stdout.trim();
    if (
      after === before ||
      actual !== (await git(root, ['hash-object', '--stdin'], { input: after })).stdout.trim()
    )
      return undefined;
  }
  return { moves, references, ...(existing.length ? { existing } : {}) } satisfies C4Preservation;
}

/** File-level work selects code leaves; broader responsibilities remain semantic context. */
export function localC4Scope(scope: C4TaskScope, model?: C4Model): C4TaskScope {
  const selected = new Set<string>();
  for (const path of scope.files) {
    const matching =
      model?.elements.filter((e) => [...e.code, ...(e.planned?.code ?? [])].includes(path)) ?? [];
    const leaves = matching.filter((e) => e.kind === 'code');
    for (const entry of leaves.length ? leaves : matching) selected.add(entry.id);
  }
  // Explicit requirement bindings cannot be narrowed by source paths.
  const spec = model?.specifications.find((s) => s.id === scope.spec);
  for (const r of spec?.requirements ?? [])
    if (scope.requirements.includes(r.id)) for (const id of r.elements) selected.add(id);
  return { ...scope, elements: [...selected].sort() };
}
