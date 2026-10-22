import { readdir, realpath, stat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import type { C4Model } from './model.ts';
import { C4_MODEL_PATH } from './model.ts';
import { readC4Model } from './shape.ts';
import { validateC4Model } from './validate.ts';
import { validateC4Documents } from './documents.ts';
import { readC4File } from './io.ts';

export async function readC4Documents(root: string): Promise<Map<string, string>> {
  const docs = new Map<string, string>();
  const paths = ['architecture.md', 'brief.md'];
  for (const sub of ['adr', 'specs', 'docs']) {
    const names = await readdir(join(root, '.skaro', sub)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    paths.push(...names.filter((n) => n.endsWith('.md')).map((n) => `${sub}/${n}`));
  }
  for (const path of paths) {
    const text = await readC4File(root, path);
    if (text !== null) docs.set(path, text);
  }
  return docs;
}

export async function validateC4Code(
  root: string,
  model: C4Model,
  taskCheckout = false,
): Promise<string[]> {
  const errors: string[] = [];
  const actualRoot = await realpath(root);
  for (const element of model.elements.filter((e) => e.state === 'current')) {
    if (taskCheckout && model.removals?.some((r) => r.id === element.id)) continue;
    for (const path of element.code) {
      if (isAbsolute(path) || path.split(/[\\/]/).includes('..') || path.includes('\\')) {
        errors.push(`${element.id}: unsafe code path ${path}`);
        continue;
      }
      try {
        const actual = await realpath(join(actualRoot, path));
        const rel = relative(actualRoot, actual);
        if (rel.startsWith('..') || isAbsolute(rel) || !(await stat(actual)).isFile())
          errors.push(`${element.id}: code path must be a project file: ${path}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        errors.push(`${element.id}: missing code path ${path}`);
      }
    }
  }
  return errors;
}

export interface C4ProjectState {
  model?: C4Model;
  problems: string[];
}

export async function inspectC4Project(root: string, _locale = 'en'): Promise<C4ProjectState> {
  const raw = await readC4File(root, C4_MODEL_PATH);
  if (raw === null)
    return {
      problems: [
        'C4 architecture model has not been prepared; architecture/specification coverage is unverified.',
      ],
    };
  let model: C4Model;
  try {
    model = readC4Model(JSON.parse(raw));
  } catch (error) {
    return { problems: [String(error)] };
  }
  const documents = await readC4Documents(root);
  const problems = [...validateC4Model(model), ...validateC4Documents(model, documents)];
  if (!documents.has('architecture.md')) problems.push('architecture.md: C4 document missing');
  return { model, problems };
}
