import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import type { ImageRef, ProjectionContext, RawLine, TimelineEvent } from '@skaro/timeline';
import { describe } from './describe.ts';

export type Direction = RawLine['dir'];

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Writes a golden session: raw.jsonl (native stream, source of truth), canonical.jsonl
 * (projection) and attachments/. Personal data (home dir, e-mails, the temp
 * workspace path) is replaced with placeholders so fixtures can be committed.
 */
export class Recorder {
  readonly ctx: ProjectionContext;
  private readonly start = Date.now();
  private current = 0;
  private readonly sanitize: (value: unknown) => unknown;

  readonly dir: string;
  private readonly quiet: boolean;

  constructor(dir: string, workspace: string, quiet = false) {
    this.dir = dir;
    this.quiet = quiet;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'attachments'), { recursive: true });
    writeFileSync(join(dir, 'raw.jsonl'), '');
    writeFileSync(join(dir, 'canonical.jsonl'), '');
    this.sanitize = createSanitizer(workspace);
    this.ctx = {
      now: () => this.current,
      attachImage: (image) => this.attach(image),
    };
  }

  /** Records a raw line and returns it sanitized, as the projector must see it. */
  raw(dir: Direction, line: unknown): unknown {
    this.current = Date.now() - this.start;
    const clean = this.sanitize(line);
    const entry: RawLine = { ts: this.current, dir, line: clean };
    appendFileSync(join(this.dir, 'raw.jsonl'), JSON.stringify(entry) + '\n');
    return clean;
  }

  canonical(event: TimelineEvent): void {
    appendFileSync(join(this.dir, 'canonical.jsonl'), JSON.stringify(event) + '\n');
    if (!this.quiet) {
      const text = describe(event);
      if (text) console.log(text);
    }
  }

  private attach(image: {
    base64: string;
    mime: string;
    width?: number;
    height?: number;
    path?: string;
  }): ImageRef {
    const bytes = Buffer.from(image.base64, 'base64');
    const id = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(this.dir, 'attachments', `${id}.${EXT[image.mime] ?? 'bin'}`), bytes);
    return { id, mime: image.mime, width: image.width, height: image.height, path: image.path };
  }
}

/** Long runs of base64 characters: image data, left untouched. */
const BASE64 = /^[A-Za-z0-9+/=\s]{256,}$/;

/**
 * Replaces the workspace path, the home dir, the user name and e-mail addresses in every string
 * of a JSON value. Paths arrive split across streaming chunks (`"Users/<name>/A"`), so the user
 * name is also replaced on its own as a word.
 */
export function createSanitizer(workspace?: string): (value: unknown) => unknown {
  const replacements = (workspace ? pathVariants(workspace, '<workspace>') : []).concat(
    pathVariants(homedir(), '<home>'),
  );
  const user = new RegExp(`\\b${escapeRegExp(userInfo().username)}\\b`, 'g');
  const clean = (text: string): string => {
    if (BASE64.test(text)) return text;
    let out = text;
    for (const [from, to] of replacements) out = out.split(from).join(to);
    out = out.replace(user, '<user>');
    return out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (email) =>
      email.endsWith('skaro.dev') ? email : '<email>',
    );
  };
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return clean(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [clean(k), walk(v)]));
    }
    return value;
  };
  return walk;
}

/** Sanitizes a JSONL file's text line by line. */
export function sanitizeJsonl(text: string, sanitize: (value: unknown) => unknown): string {
  return text
    .split('\n')
    .map((line) => (line.trim() ? JSON.stringify(sanitize(JSON.parse(line))) : line))
    .join('\n');
}

/**
 * A path as it may appear in a string: native or with forward slashes, as is or escaped once to
 * three times (paths inside command strings are escaped again), with a lower-case drive letter,
 * and as the slug Claude Code uses for project directories (C--Users-name-...).
 */
function pathVariants(path: string, placeholder: string): [string, string][] {
  const escape = (text: string) => JSON.stringify(text).slice(1, -1);
  const variants = new Set<string>();
  for (const base of [path, path.replaceAll('\\', '/')]) {
    let text = base;
    variants.add(text);
    for (let i = 0; i < 3; i++) {
      text = escape(text);
      variants.add(text);
    }
  }
  for (const v of [...variants])
    if (/^[A-Z]:/.test(v)) variants.add(v[0]!.toLowerCase() + v.slice(1));
  variants.add(path.replace(/[^A-Za-z0-9]/g, '-'));
  return [...variants].sort((a, b) => b.length - a.length).map((v) => [v, placeholder]);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
