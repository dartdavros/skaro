import type { ArtifactFiles } from './files.ts';
import { toAdr, toSpec, nextNumber } from './conversion.ts';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Adr, AdrStatus, ArtifactProblem, Doc, Spec, SpecStatus } from './model.ts';
import type { NewAdr, NewSpec } from './inputs.ts';
import { getFields, parseMarkdown, serializeMarkdown, setFields } from './frontmatter.ts';
import type { MarkdownFile } from './frontmatter.ts';
import { slugify } from './slug.ts';

export async function createAdr(files: ArtifactFiles, input: NewAdr): Promise<Adr> {
  const existing = await files.readAll('adr', [], toAdr);
  const id = String(
    nextNumber(
      existing.map((a) => a.id),
      /^(\d+)$/,
    ),
  ).padStart(4, '0');
  const file = parseMarkdown('');
  setFields(file, {
    id,
    title: input.title,
    status: input.status ?? 'proposed',
    date: input.date ?? new Date().toISOString().slice(0, 10),
    replaces: input.replaces,
  });
  file.body = input.body ?? '## Контекст\n\n## Решение\n\n## Последствия\n';
  await files.writeFile(`adr/${id}-${slugify(input.title)}.md`, serializeMarkdown(file));
  if (input.replaces && input.status === 'accepted') await supersede(files, input.replaces, id);
  return (await files.findFile('adr', id, toAdr)).item;
}

export async function setAdrStatus(
  files: ArtifactFiles,
  id: string,
  status: AdrStatus,
): Promise<Adr> {
  const { file, path, item } = await files.findFile('adr', id, toAdr);
  setFields(file, { status });
  await files.writeFile(path, serializeMarkdown(file));
  if (status === 'accepted' && item.replaces) await supersede(files, item.replaces, id);
  return (await files.findFile('adr', id, toAdr)).item;
}

export async function writeAdr(files: ArtifactFiles, id: string, body: string): Promise<Adr> {
  const { file, path } = await files.findFile('adr', id, toAdr);
  file.body = body;
  await files.writeFile(path, serializeMarkdown(file));
  return (await files.findFile('adr', id, toAdr)).item;
}

export async function createSpec(files: ArtifactFiles, input: NewSpec): Promise<Spec> {
  const existing = await files.readAll('specs', [], toSpec);
  const id = String(
    nextNumber(
      existing.map((s) => s.id),
      /^(\d+)$/,
    ),
  ).padStart(4, '0');
  const file = parseMarkdown('');
  setFields(file, {
    id,
    title: input.title,
    status: input.status ?? 'proposed',
    date: input.date ?? new Date().toISOString().slice(0, 10),
    replaces: input.replaces,
  });
  file.body =
    input.body ??
    '## Проблема\n\n\n## Сценарии\n- \n\n## Требования\n- R-1 \n\n## Не входит\n- \n\n## Открытые вопросы\n- \n';
  await files.writeFile(`specs/${id}-${slugify(input.title)}.md`, serializeMarkdown(file));
  if (input.replaces && input.status === 'accepted') {
    await supersedeIn(files, 'specs', toSpec, input.replaces, id);
  }
  return (await files.findFile('specs', id, toSpec)).item;
}

export async function setSpecStatus(
  files: ArtifactFiles,
  id: string,
  status: SpecStatus,
): Promise<Spec> {
  const { file, path, item } = await files.findFile('specs', id, toSpec);
  setFields(file, { status });
  await files.writeFile(path, serializeMarkdown(file));
  if (status === 'accepted' && item.replaces) {
    await supersedeIn(files, 'specs', toSpec, item.replaces, id);
  }
  return (await files.findFile('specs', id, toSpec)).item;
}

export async function writeSpec(files: ArtifactFiles, id: string, body: string): Promise<Spec> {
  const { file, path } = await files.findFile('specs', id, toSpec);
  file.body = body;
  await files.writeFile(path, serializeMarkdown(file));
  return (await files.findFile('specs', id, toSpec)).item;
}

export async function writeDoc(files: ArtifactFiles, path: string, body: string): Promise<Doc> {
  if (!/^(brief\.md|architecture\.md|docs\/[^/]+\.md)$/.test(path))
    throw new Error(`not a document path: ${path}`);
  let file: MarkdownFile;
  try {
    file = parseMarkdown(await readFile(join(files.dir, path), 'utf8'));
  } catch {
    file = { doc: parseMarkdown('').doc, body: '' };
  }
  file.body = body;
  const hasFrontmatter = Object.keys(getFields(file)).length > 0;
  await files.writeFile(path, hasFrontmatter ? serializeMarkdown(file) : body);
  const kind = path === 'brief.md' ? 'brief' : path === 'architecture.md' ? 'architecture' : 'doc';
  const doc = await files.readDoc(path, kind, []);
  if (!doc) throw new Error(`failed to write ${path}`);
  return doc;
}

export async function deleteDoc(files: ArtifactFiles, path: string): Promise<void> {
  if (!/^(brief\.md|architecture\.md|docs\/[^/]+\.md)$/.test(path))
    throw new Error(`not a document path: ${path}`);
  const abs = join(files.dir, path);
  await rm(abs, { force: true });
  files.ownWrites.delete(abs);
}

export async function supersede(files: ArtifactFiles, oldId: string, newId: string): Promise<void> {
  await supersedeIn(files, 'adr', toAdr, oldId, newId);
}

export async function supersedeIn<T extends { id: string }>(
  files: ArtifactFiles,
  sub: string,
  convert: (
    fields: Record<string, unknown>,
    body: string,
    path: string,
    problems: ArtifactProblem[],
  ) => T | undefined,
  oldId: string,
  newId: string,
): Promise<void> {
  const { file, path } = await files.findFile(sub, oldId, convert);
  setFields(file, { status: 'superseded', replaced_by: newId });
  await files.writeFile(path, serializeMarkdown(file));
}
