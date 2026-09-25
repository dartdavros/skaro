import { Document, isMap, parseDocument } from 'yaml';

/** A Markdown file with YAML frontmatter, editable without losing the user's formatting. */
export interface MarkdownFile {
  /** Parsed frontmatter; keeps comments and key order for round-trips. */
  doc: Document;
  body: string;
}

const BOM = String.fromCharCode(0xfeff);
const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Parses `---\nyaml\n---\nbody`. A file without frontmatter gets an empty one. Throws on invalid YAML. */
export function parseMarkdown(raw: string): MarkdownFile {
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  const match = FENCE.exec(text);
  // An empty block mapping, so new fields are written one per line.
  if (!match) return { doc: new Document({}), body: text };
  const doc = parseDocument(match[1] ?? '');
  if (doc.errors.length) throw new Error(doc.errors.map((e) => e.message).join('; '));
  if (doc.contents === null) return { doc: new Document({}), body: text.slice(match[0].length) };
  if (!isMap(doc.contents)) throw new Error('frontmatter must be a YAML mapping');
  return { doc, body: text.slice(match[0].length) };
}

export function serializeMarkdown(file: MarkdownFile): string {
  const yaml = file.doc.toString({ lineWidth: 0 }).trimEnd();
  const body = file.body.startsWith('\n') || file.body === '' ? file.body : `\n${file.body}`;
  return `---\n${yaml}\n---\n${body}`;
}

/** Sets frontmatter fields in place; `undefined` removes a field. */
export function setFields(file: MarkdownFile, fields: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) file.doc.delete(key);
    else file.doc.set(key, value);
  }
}

export function getFields(file: MarkdownFile): Record<string, unknown> {
  const json = file.doc.toJS() as unknown;
  return typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
}
