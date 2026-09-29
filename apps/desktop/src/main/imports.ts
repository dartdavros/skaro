// Import of documentation (architecture.md 12, D-31): the sources copied into the app data as
// text, the artifacts the import agent stages there, and writing the ones the user picks to
// .skaro/. The sources themselves are only read.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import type { ArtifactStore, ProjectArtifacts } from '@skaro/core';
import type { ImportKind } from '@skaro/timeline';

export type SourceKind = 'folder' | 'file' | 'archive';

/** What the import modal says about a source before the import starts. */
export interface SourceInfo {
  path: string;
  /** "~/Docs/shop" */
  display: string;
  kind: SourceKind;
  files: number;
  readable: number;
  unsupported: number;
  /** Extensions of the files that are not read: ".vsdx". */
  formats: string[];
  missing?: boolean;
}

export interface ManifestFile {
  /** As the user knows it: "~/Docs/shop/architecture.pdf", "~/Docs/old.zip/specs/a.md". */
  source: string;
  /** The copy the agent reads, relative to the import folder. */
  copy?: string;
  /** The original of a converted file (pdf), relative to the import folder. */
  original?: string;
  format: string;
  size: number;
  /** The file on disk, to open from the review screen; none inside an archive. */
  origin?: string;
  action: 'copied' | 'converted' | 'skipped';
  reason?: string;
}

export interface Manifest {
  sources: { path: string; display: string; kind: SourceKind }[];
  files: ManifestFile[];
}

export type StagedType = 'brief' | 'architecture' | 'adr' | 'spec' | 'doc' | 'milestone' | 'task';

/** An artifact the import agent staged; nothing of it is in .skaro/ yet. */
export interface StagedArtifact {
  /** The agent's key: other staged artifacts refer to it as {{key}} or in fields. */
  key: string;
  type: StagedType;
  title: string;
  body: string;
  /** Manifest sources it comes from, or "code" for the project's code. */
  sources: string[];
  /** An existing artifact it changes: ADR or specification number, document name. */
  updates?: string;
  /** Status of an ADR or a specification (accepted by default: it is a decision already made). */
  status?: 'proposed' | 'accepted' | 'superseded';
  /** Task: milestone key or id, dependencies (keys or ids), specification (key or number). */
  milestone?: string;
  dependsOn?: string[];
  spec?: string;
  /** Document file name: "glossary.md". */
  name?: string;
  /** Text now, for an update: the review shows the diff and applying checks it did not change. */
  before?: string;
}

export interface ImportReport {
  skipped: { path: string; reason: string }[];
  notes: string[];
}

export interface ImportState {
  id: string;
  /** Absolute folder of the import in the app data. */
  dir: string;
  sources: SourceInfo[];
  staged: StagedArtifact[];
  report?: ImportReport;
}

const TEXT = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.rst',
  '.adoc',
  '.asciidoc',
  '.yaml',
  '.yml',
  '.json',
]);
const CONVERT = new Set(['.docx', '.html', '.htm', '.pdf', '.csv', '.tsv', '.xlsx']);
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const ARCHIVE = new Set(['.zip']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.skaro', '.svn', '.hg', '__MACOSX']);
/** A source larger than this is read only in part: the import is about documents. */
const MAX_FILES = 3000;
const MAX_FILE_BYTES = 30 * 1024 * 1024;

export function readable(name: string): boolean {
  const ext = extname(name).toLowerCase();
  return TEXT.has(ext) || CONVERT.has(ext) || IMAGE.has(ext) || ARCHIVE.has(ext);
}

/** "~/Docs/shop" for a folder in the home directory. */
export function displayPath(path: string): string {
  const home = homedir();
  const rel = relative(home, path);
  return rel && !rel.startsWith('..') && !/^[a-z]:/i.test(rel)
    ? `~/${rel.split(sep).join('/')}`
    : path.split(sep).join('/');
}

async function walk(root: string, out: string[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= MAX_FILES) return;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(path, out);
    } else if (entry.isFile()) out.push(path);
  }
}

async function zipEntries(path: string): Promise<string[]> {
  const { unzipSync } = await import('fflate');
  const names: string[] = [];
  unzipSync(new Uint8Array(await readFile(path)), {
    filter: (file) => {
      if (!file.name.endsWith('/')) names.push(file.name);
      return false;
    },
  });
  return names;
}

/** What is in a source: files, how many Skaro reads, the formats it does not. */
export async function scanSource(path: string): Promise<SourceInfo> {
  const display = displayPath(path);
  const info = await stat(path).catch(() => undefined);
  if (!info) {
    return {
      path,
      display,
      kind: 'file',
      files: 0,
      readable: 0,
      unsupported: 0,
      formats: [],
      missing: true,
    };
  }
  let names: string[];
  let kind: SourceKind;
  if (info.isDirectory()) {
    kind = 'folder';
    const files: string[] = [];
    await walk(path, files);
    names = files;
  } else if (ARCHIVE.has(extname(path).toLowerCase())) {
    kind = 'archive';
    names = await zipEntries(path).catch(() => []);
  } else {
    kind = 'file';
    names = [path];
  }
  const unsupported = names.filter((n) => !readable(n));
  return {
    path,
    display,
    kind,
    files: names.length,
    readable: names.length - unsupported.length,
    unsupported: unsupported.length,
    formats: [...new Set(unsupported.map((n) => extname(n).toLowerCase() || n))].sort(),
  };
}

// ── the copy of the sources ──────────────────────────────────────────────────

/** Copies and converts the sources into `<dir>/source`; writes `<dir>/manifest.json`. */
export async function snapshot(sources: SourceInfo[], dir: string): Promise<Manifest> {
  const manifest: Manifest = {
    sources: sources.map((s) => ({ path: s.path, display: s.display, kind: s.kind })),
    files: [],
  };
  await mkdir(join(dir, 'source'), { recursive: true });
  for (const [i, source] of sources.entries()) {
    const base = `${i + 1}-${safeName(basename(source.path))}`;
    if (source.kind === 'folder') {
      const files: string[] = [];
      await walk(source.path, files);
      for (const file of files) {
        const rel = relative(source.path, file).split(sep).join('/');
        await addFile(
          manifest,
          dir,
          file,
          `source/${base}/${rel}`,
          `${source.display}/${rel}`,
          file,
        );
      }
    } else if (source.kind === 'archive') {
      await addArchive(manifest, dir, source.path, `source/${base}`, source.display);
    } else {
      await addFile(manifest, dir, source.path, `source/${base}`, source.display, source.path);
    }
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function addArchive(
  manifest: Manifest,
  dir: string,
  path: string,
  target: string,
  display: string,
): Promise<void> {
  const { unzipSync } = await import('fflate');
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await readFile(path)));
  } catch {
    manifest.files.push(skipped(display, 'zip', 0, 'архив не открылся'));
    return;
  }
  const unpacked = join(dir, 'unpacked', safeName(basename(path)));
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/') || name.split('/').some((p) => p === '..' || SKIP_DIRS.has(p))) continue;
    const file = join(unpacked, ...name.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
    await addFile(manifest, dir, file, `${target}/${name}`, `${display}/${name}`);
  }
}

async function addFile(
  manifest: Manifest,
  dir: string,
  file: string,
  target: string,
  display: string,
  origin?: string,
): Promise<void> {
  const ext = extname(file).toLowerCase();
  const format = ext.slice(1) || 'file';
  const size = (await stat(file).catch(() => undefined))?.size ?? 0;
  if (!readable(file) || ARCHIVE.has(ext)) {
    manifest.files.push(
      skipped(
        display,
        format,
        size,
        ARCHIVE.has(ext) ? 'архив внутри архива' : 'формат не поддерживается',
      ),
    );
    return;
  }
  if (size > MAX_FILE_BYTES) {
    manifest.files.push(skipped(display, format, size, 'файл слишком большой'));
    return;
  }
  const abs = join(dir, ...target.split('/'));
  await mkdir(dirname(abs), { recursive: true });
  try {
    if (TEXT.has(ext) || IMAGE.has(ext)) {
      await copyFile(file, abs);
      manifest.files.push({
        source: display,
        copy: target,
        format,
        size,
        ...(origin ? { origin } : {}),
        action: 'copied',
      });
      return;
    }
    const text = await convert(file, ext);
    if (!text.trim()) {
      manifest.files.push(skipped(display, format, size, 'пустой файл'));
      return;
    }
    await writeFile(`${abs}.md`, text);
    const entry: ManifestFile = {
      source: display,
      copy: `${target}.md`,
      format,
      size,
      ...(origin ? { origin } : {}),
      action: 'converted',
    };
    // The agent may look at the original of a PDF: pictures and tables do not survive as text.
    if (ext === '.pdf') {
      await copyFile(file, abs);
      entry.original = target;
    }
    manifest.files.push(entry);
  } catch {
    manifest.files.push(skipped(display, format, size, 'не удалось прочитать'));
  }
}

function skipped(source: string, format: string, size: number, reason: string): ManifestFile {
  return { source, format, size, action: 'skipped', reason };
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'source';
}

/** A document as Markdown text. */
export async function convert(file: string, ext: string): Promise<string> {
  const data = await readFile(file);
  switch (ext) {
    case '.docx': {
      const mammoth = (await import('mammoth')).default;
      const { value } = await mammoth.convertToHtml({ buffer: data });
      return htmlToMarkdown(value);
    }
    case '.html':
    case '.htm':
      return htmlToMarkdown(data.toString('utf8'));
    case '.pdf': {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const { text } = await extractText(pdf, { mergePages: true });
      return text;
    }
    case '.csv':
    case '.tsv':
      return markdownTable(parseDelimited(data.toString('utf8'), ext === '.tsv' ? '\t' : ','));
    case '.xlsx': {
      const ExcelJS = (await import('exceljs')).default;
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(data as unknown as ArrayBuffer);
      const parts: string[] = [];
      book.eachSheet((sheet) => {
        const rows: string[][] = [];
        sheet.eachRow((row) => {
          const values = Array.isArray(row.values) ? row.values.slice(1) : [];
          rows.push(values.map((v) => cellText(v)));
        });
        if (rows.length) parts.push(`## ${sheet.name}\n\n${markdownTable(rows)}`);
      });
      return parts.join('\n\n');
    }
    default:
      return '';
  }
}

async function htmlToMarkdown(html: string): Promise<string> {
  const TurndownService = (await import('turndown')).default;
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  return service.turndown(html);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    return '';
  }
  return String(value);
}

/** CSV with quotes. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function markdownTable(rows: string[][]): string {
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) =>
    `| ${Array.from({ length: width }, (_, i) =>
      (r[i] ?? '')
        .replace(/\|/g, '\\|')
        .replace(/\s*\n\s*/g, ' ')
        .trim(),
    ).join(' | ')} |`;
  return [line(rows[0]!), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n');
}

// ── import state on disk ─────────────────────────────────────────────────────

export async function saveState(state: ImportState): Promise<void> {
  await mkdir(state.dir, { recursive: true });
  await writeFile(join(state.dir, 'state.json'), JSON.stringify(state, null, 2));
}

export async function loadState(dir: string): Promise<ImportState | undefined> {
  try {
    return JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')) as ImportState;
  } catch {
    return undefined;
  }
}

export async function loadManifest(dir: string): Promise<Manifest | undefined> {
  try {
    return JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Manifest;
  } catch {
    return undefined;
  }
}

/** The copy and the staged artifacts go once the import is decided. */
export async function removeImport(dir: string): Promise<void> {
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
}

// ── what the review screen and the card show ─────────────────────────────────

/** "Бриф", "4 ADR", "2 этапа · 6 задач": a line per kind, in the review screen's order. */
export function importGroups(
  staged: StagedArtifact[],
): { kind: ImportKind; count: number; tasks?: number; updates: number }[] {
  const of = (types: StagedType[]) => staged.filter((s) => types.includes(s.type));
  const groups: { kind: ImportKind; count: number; tasks?: number; updates: number }[] = [];
  for (const kind of ['brief', 'architecture', 'adr', 'spec', 'doc'] as const) {
    const items = of([kind]);
    if (items.length) {
      groups.push({ kind, count: items.length, updates: items.filter((s) => s.updates).length });
    }
  }
  const milestones = of(['milestone']);
  const tasks = of(['task']);
  if (milestones.length || tasks.length) {
    groups.push({
      kind: 'plan',
      count: milestones.length,
      tasks: tasks.length,
      updates: 0,
    });
  }
  return groups;
}

// ── applying ─────────────────────────────────────────────────────────────────

export interface Applied {
  imported: { kind: ImportKind; code?: string; title: string; update: boolean }[];
  /** Links to artifacts that were not picked, left out. */
  dropped: string[];
}

/**
 * Writes the picked artifacts. Numbers are given first (the store numbers ADRs, specifications,
 * milestones and tasks in order), so {{key}} in any text and the keys in task fields become the
 * real ids; links to artifacts that were not picked are left out.
 */
export async function applyImport(
  store: ArtifactStore,
  artifacts: ProjectArtifacts,
  staged: StagedArtifact[],
  picked: string[],
  progress: (done: number, total: number) => void = () => undefined,
): Promise<Applied> {
  const chosen = staged.filter((s) => picked.includes(s.key));
  const byKey = new Map(staged.map((s) => [s.key, s]));

  // Updates first check that nothing changed on disk since the agent staged them.
  for (const s of chosen) {
    if (!s.updates && s.type !== 'brief' && s.type !== 'architecture') continue;
    const now = currentText(artifacts, s);
    if (s.before !== undefined && now !== undefined && !sameText(now, s.before)) {
      throw new ChangedOnDisk(pathOf(artifacts, s));
    }
  }

  const next = (ids: string[], pattern: RegExp) =>
    Math.max(0, ...ids.map((id) => Number(pattern.exec(id)?.[1] ?? 0))) + 1;
  let adr = next(
    artifacts.adrs.map((a) => a.id),
    /^(\d+)$/,
  );
  let spec = next(
    artifacts.specs.map((s) => s.id),
    /^(\d+)$/,
  );
  let milestone = next(
    artifacts.milestones.map((m) => m.id),
    /^M(\d+)$/,
  );
  let task = next(
    artifacts.tasks.map((t) => t.id),
    /^T-(\d+)$/,
  );
  const ids = new Map<string, string>();
  const codes = new Map<string, string>();
  for (const s of chosen) {
    if (s.type === 'adr') {
      const id = s.updates ?? String(adr++).padStart(4, '0');
      ids.set(s.key, id);
      codes.set(s.key, `ADR-${id}`);
    } else if (s.type === 'spec') {
      const id = s.updates ?? String(spec++).padStart(4, '0');
      ids.set(s.key, id);
      codes.set(s.key, `SPEC-${id}`);
    } else if (s.type === 'milestone') {
      const id = `M${String(milestone++).padStart(2, '0')}`;
      ids.set(s.key, id);
      codes.set(s.key, id);
    } else if (s.type === 'task') {
      const id = `T-${String(task++).padStart(3, '0')}`;
      ids.set(s.key, id);
      codes.set(s.key, id);
    }
  }

  const dropped: string[] = [];
  const text = (body: string, owner: StagedArtifact) =>
    body.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key: string) => {
      const code = codes.get(key);
      if (code) return code;
      const other = byKey.get(key);
      if (other) dropped.push(`${owner.title} → ${other.title}`);
      return other ? `«${other.title}»` : key;
    });
  /** A task field: a staged key when picked, an existing id as it is, else nothing. */
  const ref = (value: string | undefined, owner: StagedArtifact): string | undefined => {
    if (!value) return undefined;
    if (ids.has(value)) return ids.get(value);
    const other = byKey.get(value);
    if (other) {
      dropped.push(`${owner.title} → ${other.title}`);
      return undefined;
    }
    return value;
  };

  const imported: Applied['imported'] = [];
  const order: StagedType[] = ['brief', 'architecture', 'doc', 'adr', 'spec', 'milestone', 'task'];
  const sorted = [...chosen].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  let done = 0;
  for (const s of sorted) {
    progress(done++, sorted.length);
    const body = text(s.body, s);
    switch (s.type) {
      case 'brief':
      case 'architecture': {
        const update =
          (s.type === 'brief' ? artifacts.brief : artifacts.architecture) !== undefined;
        await store.writeDoc(`${s.type}.md`, body);
        imported.push({ kind: s.type, title: s.title, update });
        break;
      }
      case 'doc': {
        const name = docName(s);
        const update = artifacts.docs.some((d) => d.path === `.skaro/docs/${name}`);
        await store.writeDoc(`docs/${name}`, body);
        imported.push({ kind: 'doc', title: name, update });
        break;
      }
      case 'adr': {
        if (s.updates) await store.writeAdr(s.updates, body);
        else {
          await store.createAdr({ title: s.title, body, status: s.status ?? 'accepted' });
        }
        imported.push({ kind: 'adr', code: codes.get(s.key), title: s.title, update: !!s.updates });
        break;
      }
      case 'spec': {
        if (s.updates) await store.writeSpec(s.updates, body);
        else await store.createSpec({ title: s.title, body, status: s.status ?? 'accepted' });
        imported.push({
          kind: 'spec',
          code: codes.get(s.key),
          title: s.title,
          update: !!s.updates,
        });
        break;
      }
      case 'milestone': {
        await store.createMilestone({ title: s.title, body });
        imported.push({ kind: 'plan', code: codes.get(s.key), title: s.title, update: false });
        break;
      }
      case 'task': {
        const inMilestone = ref(s.milestone, s);
        const specId = ref(s.spec, s);
        await store.createTask({
          title: s.title,
          body,
          ...(inMilestone ? { milestone: inMilestone } : {}),
          ...(specId ? { spec: specId } : {}),
        });
        imported.push({ kind: 'plan', code: codes.get(s.key), title: s.title, update: false });
        break;
      }
    }
  }
  // Dependencies once every picked task has its id.
  for (const s of sorted.filter((x) => x.type === 'task')) {
    const deps = (s.dependsOn ?? []).map((d) => ref(d, s)).filter((d): d is string => !!d);
    if (deps.length) await store.updateTask(ids.get(s.key)!, { dependsOn: deps });
  }
  progress(sorted.length, sorted.length);
  return { imported, dropped: [...new Set(dropped)] };
}

export class ChangedOnDisk extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`${path} changed on disk`);
    this.path = path;
  }
}

function docName(s: StagedArtifact): string {
  const raw = (s.updates ?? s.name ?? s.title).replace(/\.md$/i, '');
  const clean = raw
    .toLowerCase()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${clean || 'document'}.md`;
}

/** Text the artifact has in .skaro/ now, for an update. */
export function currentText(artifacts: ProjectArtifacts, s: StagedArtifact): string | undefined {
  switch (s.type) {
    case 'brief':
      return artifacts.brief?.body;
    case 'architecture':
      return artifacts.architecture?.body;
    case 'doc':
      return artifacts.docs.find((d) => d.path === `.skaro/docs/${docName(s)}`)?.body;
    case 'adr':
      return s.updates ? artifacts.adrs.find((a) => a.id === s.updates)?.body : undefined;
    case 'spec':
      return s.updates ? artifacts.specs.find((x) => x.id === s.updates)?.body : undefined;
    default:
      return undefined;
  }
}

export function pathOf(artifacts: ProjectArtifacts, s: StagedArtifact): string {
  switch (s.type) {
    case 'brief':
      return '.skaro/brief.md';
    case 'architecture':
      return '.skaro/architecture.md';
    case 'doc':
      return `.skaro/docs/${docName(s)}`;
    case 'adr':
      return artifacts.adrs.find((a) => a.id === s.updates)?.path ?? '.skaro/adr/';
    case 'spec':
      return artifacts.specs.find((x) => x.id === s.updates)?.path ?? '.skaro/specs/';
    default:
      return '.skaro/';
  }
}

function sameText(a: string, b: string): boolean {
  return a.replace(/\s+$/, '') === b.replace(/\s+$/, '');
}

export { docName };
