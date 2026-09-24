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
  private readonly sanitize: (text: string) => string;

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
    const clean = JSON.parse(this.sanitize(JSON.stringify(line))) as unknown;
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

/** Replaces the workspace path, the home dir and e-mail addresses in serialized JSON. */
export function createSanitizer(workspace?: string): (text: string) => string {
  const replacements = (workspace ? pathVariants(workspace, '<workspace>') : []).concat(
    pathVariants(homedir(), '<home>'),
  );
  // The user name also shows up on its own (e.g. `ls -l` owner column). Match it only outside
  // base64-like runs so image data stays intact.
  const user = new RegExp(
    `(?<![A-Za-z0-9+/=])${escapeRegExp(userInfo().username)}(?![A-Za-z0-9+/=])`,
    'g',
  );
  return (text) => {
    let out = text;
    for (const [from, to] of replacements) out = out.split(from).join(to);
    out = out.replace(user, '<user>');
    return out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (email) =>
      email.endsWith('skaro.dev') ? email : '<email>',
    );
  };
}

/**
 * A path as it may appear in serialized JSON: native or with forward slashes, escaped once to
 * three times (paths inside command strings are escaped again), with a lower-case drive letter,
 * and as the slug Claude Code uses for project directories (C--Users-name-...).
 */
function pathVariants(path: string, placeholder: string): [string, string][] {
  const escape = (text: string) => JSON.stringify(text).slice(1, -1);
  const variants = new Set<string>();
  for (const base of [path, path.replaceAll('\\', '/')]) {
    let text = base;
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
