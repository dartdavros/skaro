import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { str } from './conversion.ts';
import type { ArtifactProblem, Doc } from './model.ts';
import { getFields, parseMarkdown } from './frontmatter.ts';
import type { MarkdownFile } from './frontmatter.ts';

export const SKARO_DIR = '.skaro';

/** File access and observation shared by artifact operations. */
export class ArtifactFiles {
  readonly dir: string;
  readonly ownWrites = new Map<string, string>();
  readonly root: string;
  constructor(root: string) {
    this.root = root;
    this.dir = join(root, SKARO_DIR);
  }

  watch(onChange: (paths: string[]) => void, debounceMs = 150): () => void {
    const pending = new Set<string>();
    let timer: NodeJS.Timeout | undefined;
    const flush = async () => {
      timer = undefined;
      const changed: string[] = [];
      for (const path of pending) {
        const abs = join(this.dir, path);
        const own = this.ownWrites.get(abs);
        if (own !== undefined) {
          const now = await readFile(abs, 'utf8').catch(() => undefined);
          if (now === own) continue;
          this.ownWrites.delete(abs);
        }
        changed.push(path.split(sep).join('/'));
      }
      pending.clear();
      if (changed.length) onChange(changed.sort());
    };
    let watcher: FSWatcher;
    try {
      watcher = watch(this.dir, { recursive: true }, (_event, name) => {
        if (!name) return;
        pending.add(name.toString());
        clearTimeout(timer);
        timer = setTimeout(() => void flush(), debounceMs);
      });
    } catch {
      return () => undefined; // no .skaro/ yet
    }
    return () => {
      clearTimeout(timer);
      watcher.close();
    };
  }

  async writeFile(path: string, content: string): Promise<void> {
    const abs = join(this.dir, path);
    await mkdir(dirname(abs), { recursive: true });
    this.ownWrites.set(abs, content);
    await writeFile(abs, content);
  }

  async list(sub: string): Promise<string[]> {
    try {
      return (await readdir(join(this.dir, sub))).filter((n) => n.endsWith('.md')).sort();
    } catch {
      return [];
    }
  }

  async readAll<T>(
    sub: string,
    problems: ArtifactProblem[],
    convert: (
      fields: Record<string, unknown>,
      body: string,
      path: string,
      problems: ArtifactProblem[],
    ) => T | undefined,
  ): Promise<T[]> {
    const out: T[] = [];
    for (const name of await this.list(sub)) {
      const path = `${sub}/${name}`;
      try {
        const file = parseMarkdown(await readFile(join(this.dir, path), 'utf8'));
        const item = convert(getFields(file), file.body, `${SKARO_DIR}/${path}`, problems);
        if (item) out.push(item);
      } catch (error) {
        problems.push({
          path: `${SKARO_DIR}/${path}`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return out;
  }

  async findFile<T extends { id: string }>(
    sub: string,
    id: string,
    convert: (
      fields: Record<string, unknown>,
      body: string,
      path: string,
      problems: ArtifactProblem[],
    ) => T | undefined,
  ): Promise<{ file: MarkdownFile; path: string; item: T }> {
    for (const name of await this.list(sub)) {
      const path = `${sub}/${name}`;
      let file: MarkdownFile;
      try {
        file = parseMarkdown(await readFile(join(this.dir, path), 'utf8'));
      } catch {
        continue;
      }
      const item = convert(getFields(file), file.body, `${SKARO_DIR}/${path}`, []);
      if (item?.id === id) return { file, path, item };
    }
    throw new Error(`${sub}: ${id} not found`);
  }

  async readDoc(
    path: string,
    kind: Doc['kind'],
    problems: ArtifactProblem[],
  ): Promise<Doc | undefined> {
    let text: string;
    try {
      text = await readFile(join(this.dir, path), 'utf8');
    } catch {
      return undefined;
    }
    let body = text;
    let title: string | undefined;
    try {
      const file = parseMarkdown(text);
      body = file.body;
      title = str(getFields(file)['title']);
    } catch (error) {
      problems.push({
        path: `${SKARO_DIR}/${path}`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    title ??= /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? path.split('/').pop()!.replace(/\.md$/, '');
    return { kind, title, body, path: `${SKARO_DIR}/${path}` };
  }
}
